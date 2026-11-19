import { Hono } from 'hono';
import { todayIST } from '../../shared/dates';
import {
  enrolmentCreateInput,
  enrolmentUpdateInput,
  studentCreateInput,
  studentPersonInput,
} from '../../shared/schemas';
import type { Enrolment, Paged, Student, StudentDetail, StudentListRow } from '../../shared/types';
import type { AppEnv, AuthUser, Ctx } from '../env';
import { audit } from './audit';
import { assertBranch, branchScope, requirePermission, scopeSql } from './auth';
import { AppError, intParam, notFound, parse } from './errors';

export const studentRoutes = new Hono<AppEnv>();
const PAGE_SIZE = 30;

studentRoutes.get('/students', requirePermission('students.view'), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const q = c.req.query();
  const page = Math.max(1, Number(q.page) || 1);
  const where: string[] = ['e.session_id = ?'];
  const params: unknown[] = [Number(q.session_id) || 0];
  for (const key of ['branch_id', 'class_id', 'section_id'] as const) {
    if (Number(q[key])) {
      where.push(`e.${key} = ?`);
      params.push(Number(q[key]));
    }
  }
  if (q.status === 'studying' || q.status === 'left') {
    where.push('e.status = ?');
    params.push(q.status);
  }
  const search = (q.q ?? '').trim().slice(0, 50);
  if (search) {
    const like = `%${search.replace(/[%_\\]/g, '\\$&')}%`;
    where.push(
      `(s.name LIKE ? ESCAPE '\\' OR s.father_name LIKE ? ESCAPE '\\' OR s.phone LIKE ? ESCAPE '\\'
        OR s.phone2 LIKE ? ESCAPE '\\' OR s.admission_no LIKE ? ESCAPE '\\' OR e.roll_no = ?)`,
    );
    params.push(like, like, like, like, like, /^\d+$/.test(search) ? Number(search) : -1);
  }
  const from = `FROM enrolments e JOIN students s ON s.id = e.student_id
    JOIN sections sec ON sec.id = e.section_id JOIN classes cl ON cl.id = e.class_id
    WHERE ${where.join(' AND ')} ${scopeSql(user, 'e.branch_id')}`;
  const [rows, count] = await db.batch([
    db
      .prepare(
        `SELECT e.id AS enrolment_id, s.id AS student_id, s.admission_no, s.name, s.father_name, s.phone,
                e.branch_id, e.class_id, e.section_id, sec.name AS section_name, e.roll_no,
                e.admission_type, e.status, e.result
         ${from} ORDER BY cl.sort_order, sec.name, e.roll_no IS NULL, e.roll_no, s.name LIMIT ? OFFSET ?`,
      )
      .bind(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    db.prepare(`SELECT COUNT(*) AS n ${from}`).bind(...params),
  ]);
  return c.json<Paged<StudentListRow>>({
    rows: rows!.results as StudentListRow[],
    page,
    page_size: PAGE_SIZE,
    total: (count!.results[0] as { n: number }).n,
  });
});

async function loadStudent(c: Ctx, id: number): Promise<StudentDetail> {
  const db = c.env.DB;
  const [student, enrolments] = await db.batch([
    db
      .prepare(
        'SELECT id, admission_no, name, father_name, mother_name, phone, phone2, address, dob, gender FROM students WHERE id = ?',
      )
      .bind(id),
    db
      .prepare(
        `SELECT e.id, e.student_id, e.session_id, ses.name AS session_name, e.branch_id, e.class_id,
                e.section_id, sec.name AS section_name, e.roll_no, e.admission_type, e.status,
                e.left_date, e.result
           FROM enrolments e JOIN academic_sessions ses ON ses.id = e.session_id
           JOIN sections sec ON sec.id = e.section_id
          WHERE e.student_id = ? ORDER BY ses.start_year DESC`,
      )
      .bind(id),
  ]);
  const row = student!.results[0] as Student | undefined;
  if (!row) throw notFound('Student');
  const detail = { student: row, enrolments: enrolments!.results as Enrolment[] };
  assertStudentInScope(c.get('user'), detail);
  return detail;
}

/** Non-admins can open a student only if the student has studied in one of their branches. */
function assertStudentInScope(user: AuthUser, detail: StudentDetail): void {
  const scope = branchScope(user);
  if (scope && !detail.enrolments.some((e) => scope.includes(e.branch_id))) {
    throw new AppError(403, 'This student is in a branch you do not have access to.');
  }
}

studentRoutes.get('/students/:id', requirePermission('students.view'), async (c) => {
  return c.json(await loadStudent(c, intParam(c.req.param('id'), 'Student')));
});

/** Checks the section belongs to the branch and class, and the roll number is free. */
async function checkPlace(
  c: Ctx,
  place: { branch_id: number; class_id: number; section_id: number; roll_no: number | null },
  sessionId: number,
  ignoreEnrolmentId = 0,
): Promise<void> {
  const db = c.env.DB;
  const [section, roll, session] = await db.batch([
    db
      .prepare('SELECT id FROM sections WHERE id = ? AND branch_id = ? AND class_id = ?')
      .bind(place.section_id, place.branch_id, place.class_id),
    db
      .prepare(
        `SELECT s.name FROM enrolments e JOIN students s ON s.id = e.student_id
          WHERE e.session_id = ? AND e.section_id = ? AND e.roll_no = ? AND e.id <> ?`,
      )
      .bind(sessionId, place.section_id, place.roll_no, ignoreEnrolmentId),
    db.prepare('SELECT id FROM academic_sessions WHERE id = ?').bind(sessionId),
  ]);
  if (!session!.results.length) throw notFound('Session');
  if (!section!.results.length) {
    throw new AppError(
      400,
      'That section does not belong to this branch and class. Choose the section again.',
      { section_id: 'Choose again' },
    );
  }
  const taken = roll!.results[0] as { name: string } | undefined;
  if (place.roll_no !== null && taken) {
    throw new AppError(
      409,
      `Roll number ${place.roll_no} is already given to ${taken.name} in this section. Use a different number.`,
      { roll_no: 'Already used' },
    );
  }
}

studentRoutes.post('/students', requirePermission('students.edit'), async (c) => {
  const db = c.env.DB;
  const input = parse(studentCreateInput, await c.req.json());
  const place = input.enrolment;
  assertBranch(c.get('user'), place.branch_id);
  await checkPlace(c, place, input.session_id);
  let admissionNo = input.admission_no;
  if (!admissionNo) {
    const next = await db
      .prepare(
        "SELECT COALESCE(MAX(CAST(admission_no AS INTEGER)), 0) + 1 AS n FROM students WHERE admission_no GLOB '[0-9]*'",
      )
      .first<{ n: number }>();
    admissionNo = String(next!.n);
  }
  const now = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO students (admission_no, name, father_name, mother_name, phone, phone2, address, dob, gender, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          admissionNo,
          input.name,
          input.father_name,
          input.mother_name,
          input.phone,
          input.phone2,
          input.address,
          input.dob,
          input.gender,
          now,
          now,
        ),
      audit(c, {
        action: 'create',
        entity: 'student',
        entity_id: 'last',
        branch_id: place.branch_id,
        summary: `Added student ${input.name} (${admissionNo})`,
      }),
      db
        .prepare(
          `INSERT INTO enrolments (student_id, session_id, branch_id, class_id, section_id, roll_no, admission_type, status, created_at, updated_at)
           VALUES ((SELECT id FROM students WHERE admission_no = ?), ?, ?, ?, ?, ?, ?, 'studying', ?, ?)`,
        )
        .bind(
          admissionNo,
          input.session_id,
          place.branch_id,
          place.class_id,
          place.section_id,
          place.roll_no,
          place.admission_type,
          now,
          now,
        ),
    ]);
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint failed: students.admission_no/i.test(e.message)) {
      throw new AppError(
        409,
        `Admission number ${admissionNo} is already used by another student. Enter a different one.`,
        { admission_no: 'Already used' },
      );
    }
    throw e;
  }
  const created = await db
    .prepare('SELECT id FROM students WHERE admission_no = ?')
    .bind(admissionNo)
    .first<{ id: number }>();
  return c.json({ ok: true, id: created!.id });
});

studentRoutes.put('/students/:id', requirePermission('students.edit'), async (c) => {
  const db = c.env.DB;
  const id = intParam(c.req.param('id'), 'Student');
  const input = parse(studentPersonInput, await c.req.json());
  const detail = await loadStudent(c, id);
  const admissionNo = input.admission_no || detail.student.admission_no;
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE students SET admission_no = ?, name = ?, father_name = ?, mother_name = ?, phone = ?, phone2 = ?,
                  address = ?, dob = ?, gender = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(
          admissionNo,
          input.name,
          input.father_name,
          input.mother_name,
          input.phone,
          input.phone2,
          input.address,
          input.dob,
          input.gender,
          new Date().toISOString(),
          id,
        ),
      audit(c, {
        action: 'update',
        entity: 'student',
        entity_id: id,
        branch_id: detail.enrolments[0]?.branch_id,
        summary: `Edited student ${input.name}`,
        details: { before: detail.student, after: input },
      }),
    ]);
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint/i.test(e.message)) {
      throw new AppError(
        409,
        `Admission number ${admissionNo} is already used by another student. Enter a different one.`,
        { admission_no: 'Already used' },
      );
    }
    throw e;
  }
  return c.json({ ok: true });
});

/** Puts an existing student into a session they have no record for (for example, rejoining). */
studentRoutes.post('/students/:id/enrolments', requirePermission('students.edit'), async (c) => {
  const db = c.env.DB;
  const id = intParam(c.req.param('id'), 'Student');
  const input = parse(enrolmentCreateInput, await c.req.json());
  assertBranch(c.get('user'), input.branch_id);
  const detail = await loadStudent(c, id);
  if (detail.enrolments.some((e) => e.session_id === input.session_id)) {
    throw new AppError(409, 'This student already has a class for that session. Edit it instead.');
  }
  await checkPlace(c, input, input.session_id);
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO enrolments (student_id, session_id, branch_id, class_id, section_id, roll_no, admission_type, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'studying', ?, ?)`,
      )
      .bind(
        id,
        input.session_id,
        input.branch_id,
        input.class_id,
        input.section_id,
        input.roll_no,
        input.admission_type,
        now,
        now,
      ),
    audit(c, {
      action: 'create',
      entity: 'enrolment',
      entity_id: 'last',
      branch_id: input.branch_id,
      summary: `Enrolled ${detail.student.name} in a session`,
      details: input,
    }),
  ]);
  return c.json({ ok: true });
});

studentRoutes.put('/enrolments/:id', requirePermission('students.edit'), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const id = intParam(c.req.param('id'), 'Class record');
  const input = parse(enrolmentUpdateInput, await c.req.json());
  const existing = await db
    .prepare(
      `SELECT e.*, s.name AS student_name FROM enrolments e JOIN students s ON s.id = e.student_id WHERE e.id = ?`,
    )
    .bind(id)
    .first<Enrolment & { student_name: string }>();
  if (!existing) throw notFound('Class record');
  assertBranch(user, existing.branch_id);
  assertBranch(user, input.branch_id);
  await checkPlace(c, input, existing.session_id, id);
  const leftDate = input.status === 'left' ? (input.left_date ?? todayIST()) : null;
  if (leftDate && leftDate > todayIST()) {
    throw new AppError(400, 'The leaving date cannot be in the future.', {
      left_date: 'In the future',
    });
  }
  const result = input.result === undefined ? existing.result : input.result;
  const leaving = input.status === 'left' && existing.status !== 'left';
  await db.batch([
    db
      .prepare(
        `UPDATE enrolments SET branch_id = ?, class_id = ?, section_id = ?, roll_no = ?, admission_type = ?,
                status = ?, left_date = ?, result = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(
        input.branch_id,
        input.class_id,
        input.section_id,
        input.roll_no,
        input.admission_type,
        input.status,
        leftDate,
        result,
        new Date().toISOString(),
        id,
      ),
    audit(c, {
      action: 'update',
      entity: 'enrolment',
      entity_id: id,
      branch_id: input.branch_id,
      summary: leaving
        ? `Marked ${existing.student_name} as left`
        : `Edited class details of ${existing.student_name}`,
      details: { before: existing, after: { ...input, left_date: leftDate, result } },
    }),
  ]);
  return c.json({ ok: true });
});
