import { Hono } from 'hono';
import { todayIST } from '../../shared/dates';
import { promotionInput, type PromotionInput } from '../../shared/schemas';
import type { PromotionCandidate, PromotionResult, SchoolClass } from '../../shared/types';
import type { AppEnv } from '../env';
import { enrolmentHooks } from '../modules';
import { audit } from './audit';
import { assertBranch, requirePermission } from './auth';
import { AppError, parse } from './errors';

export const promotionRoutes = new Hono<AppEnv>();

interface Candidate {
  enrolment_id: number;
  student_id: number;
  section_name: string;
  roll_no: number | null;
  status: 'studying' | 'left';
  already_moved: number;
}
interface TargetSection {
  class_id: number;
  name: string;
  max_roll: number | null;
}
export interface PromotionPlan {
  /** Year-end results to record on this session's enrolments. */
  results: { id: number; result: 'pass' | 'fail' }[];
  /** Enrolments to mark as left. */
  left: number[];
  /** New enrolments for the next session. */
  moves: { student_id: number; class_id: number; section_name: string; roll_no: number }[];
  /** Sections that must exist in the next class before moving. */
  sections: { class_id: number; name: string }[];
  summary: PromotionResult;
}

/**
 * Pure planning of a class promotion.
 *  - pass → next class (Class 12 passes out: result is recorded, no new enrolment)
 *  - fail → same class again in the next session
 *  - left → marked as left, not moved
 * Students keep their section; roll numbers continue after the highest one already in the
 * target section, in the order of their old roll numbers.
 */
export function planPromotion(
  outcomes: PromotionInput['outcomes'],
  candidates: Candidate[],
  classId: number,
  classes: SchoolClass[],
  targetSections: TargetSection[],
): PromotionPlan {
  const sorted = [...classes].sort((a, b) => a.sort_order - b.sort_order);
  const nextClass = sorted[sorted.findIndex((cl) => cl.id === classId) + 1] ?? null;
  const byId = new Map(candidates.map((cd) => [cd.enrolment_id, cd]));
  const plan: PromotionPlan = {
    results: [],
    left: [],
    moves: [],
    sections: [],
    summary: { promoted: 0, repeating: 0, passed_out: 0, left: 0, skipped: 0 },
  };
  const nextRoll = new Map<string, number>();
  const rollFor = (targetClass: number, section: string) => {
    const key = `${targetClass}|${section.toUpperCase()}`;
    if (!nextRoll.has(key)) {
      const existing = targetSections.find(
        (s) => s.class_id === targetClass && s.name.toUpperCase() === section.toUpperCase(),
      );
      if (!existing) plan.sections.push({ class_id: targetClass, name: section });
      nextRoll.set(key, (existing?.max_roll ?? 0) + 1);
    }
    const roll = nextRoll.get(key)!;
    nextRoll.set(key, roll + 1);
    return roll;
  };
  const ordered = outcomes
    .map((o) => ({ ...o, cd: byId.get(o.enrolment_id) }))
    .sort((a, b) => (a.cd?.roll_no ?? 99999) - (b.cd?.roll_no ?? 99999));
  for (const { outcome, cd } of ordered) {
    if (!cd)
      throw new AppError(
        400,
        'Some students in the list are not in this class any more. Reload the page and try again.',
      );
    if (cd.already_moved) {
      plan.summary.skipped++;
      continue;
    }
    if (outcome === 'left' || cd.status === 'left') {
      if (cd.status !== 'left') plan.left.push(cd.enrolment_id);
      plan.summary.left++;
      continue;
    }
    plan.results.push({ id: cd.enrolment_id, result: outcome });
    if (outcome === 'pass' && !nextClass) {
      plan.summary.passed_out++;
      continue;
    }
    const target = outcome === 'pass' ? nextClass!.id : classId;
    plan.moves.push({
      student_id: cd.student_id,
      class_id: target,
      section_name: cd.section_name,
      roll_no: rollFor(target, cd.section_name),
    });
    if (outcome === 'pass') plan.summary.promoted++;
    else plan.summary.repeating++;
  }
  return plan;
}

promotionRoutes.get('/promotion/candidates', requirePermission('students.promote'), async (c) => {
  const q = c.req.query();
  const branchId = Number(q.branch_id) || 0;
  assertBranch(c.get('user'), branchId);
  const { results } = await c.env.DB.prepare(
    `SELECT e.id AS enrolment_id, s.id AS student_id, s.admission_no, s.name, s.father_name,
            sec.name AS section_name, e.roll_no, e.status, e.result,
            EXISTS (SELECT 1 FROM enrolments t WHERE t.student_id = e.student_id AND t.session_id = ?1) AS already_moved
       FROM enrolments e JOIN students s ON s.id = e.student_id JOIN sections sec ON sec.id = e.section_id
      WHERE e.session_id = ?2 AND e.branch_id = ?3 AND e.class_id = ?4
      ORDER BY sec.name, e.roll_no IS NULL, e.roll_no, s.name LIMIT 300`,
  )
    .bind(
      Number(q.to_session_id) || 0,
      Number(q.from_session_id) || 0,
      branchId,
      Number(q.class_id) || 0,
    )
    .all<PromotionCandidate>();
  return c.json(results);
});

promotionRoutes.post('/promotion', requirePermission('students.promote'), async (c) => {
  const db = c.env.DB;
  const input = parse(promotionInput, await c.req.json());
  assertBranch(c.get('user'), input.branch_id);
  const ids = JSON.stringify(input.outcomes.map((o) => o.enrolment_id));
  const [sessions, classes, candidates, targets] = await db.batch([
    db
      .prepare('SELECT id, name, start_year FROM academic_sessions WHERE id IN (?, ?)')
      .bind(input.from_session_id, input.to_session_id),
    db.prepare('SELECT id, name, sort_order FROM classes'),
    db
      .prepare(
        `SELECT e.id AS enrolment_id, e.student_id, sec.name AS section_name, e.roll_no, e.status,
                EXISTS (SELECT 1 FROM enrolments t WHERE t.student_id = e.student_id AND t.session_id = ?1) AS already_moved
           FROM enrolments e JOIN sections sec ON sec.id = e.section_id
          WHERE e.session_id = ?2 AND e.branch_id = ?3 AND e.class_id = ?4
            AND e.id IN (SELECT value FROM json_each(?5))`,
      )
      .bind(input.to_session_id, input.from_session_id, input.branch_id, input.class_id, ids),
    db
      .prepare(
        `SELECT sec.class_id, sec.name,
                (SELECT MAX(roll_no) FROM enrolments WHERE session_id = ?1 AND section_id = sec.id) AS max_roll
           FROM sections sec WHERE sec.branch_id = ?2`,
      )
      .bind(input.to_session_id, input.branch_id),
  ]);
  const sessionRows = sessions!.results as { id: number; name: string; start_year: number }[];
  const from = sessionRows.find((s) => s.id === input.from_session_id);
  const to = sessionRows.find((s) => s.id === input.to_session_id);
  if (!from || !to || to.start_year !== from.start_year + 1) {
    throw new AppError(
      400,
      'Students can only be moved to the session that comes right after. Open the next session first under Sessions.',
    );
  }
  const classRows = classes!.results as SchoolClass[];
  const cls = classRows.find((cl) => cl.id === input.class_id);
  if (!cls) throw new AppError(400, 'Choose a class.');
  const plan = planPromotion(
    input.outcomes,
    candidates!.results as Candidate[],
    input.class_id,
    classRows,
    targets!.results as TargetSection[],
  );

  const now = new Date().toISOString();
  const today = todayIST();
  await db.batch([
    db
      .prepare(
        `UPDATE enrolments SET result = j.value->>'result', updated_at = ?2
           FROM json_each(?1) j WHERE enrolments.id = j.value->>'id'`,
      )
      .bind(JSON.stringify(plan.results), now),
    db
      .prepare(
        `UPDATE enrolments SET status = 'left', left_date = ?2, updated_at = ?3
          WHERE id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(JSON.stringify(plan.left), today, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO sections (branch_id, class_id, name)
         SELECT ?2, j.value->>'class_id', j.value->>'name' FROM json_each(?1) j`,
      )
      .bind(JSON.stringify(plan.sections), input.branch_id),
    db
      .prepare(
        `INSERT INTO enrolments (student_id, session_id, branch_id, class_id, section_id, roll_no, admission_type, status, created_at, updated_at)
         SELECT j.value->>'student_id', ?2, ?3, j.value->>'class_id',
                (SELECT id FROM sections WHERE branch_id = ?3 AND class_id = j.value->>'class_id' AND name = j.value->>'section_name'),
                j.value->>'roll_no', 'old', 'studying', ?4, ?4
           FROM json_each(?1) j
          WHERE NOT EXISTS (SELECT 1 FROM enrolments t WHERE t.student_id = j.value->>'student_id' AND t.session_id = ?2)`,
      )
      .bind(JSON.stringify(plan.moves), input.to_session_id, input.branch_id, now),
    audit(c, {
      action: 'update',
      entity: 'promotion',
      branch_id: input.branch_id,
      summary: `Moved ${cls.name} from ${from.name} to ${to.name}: ${plan.summary.promoted} promoted, ${plan.summary.repeating} repeating, ${plan.summary.passed_out} passed out, ${plan.summary.left} left`,
      details: plan.summary,
    }),
    ...enrolmentHooks(c, input.to_session_id),
  ]);
  return c.json<PromotionResult>(plan.summary);
});
