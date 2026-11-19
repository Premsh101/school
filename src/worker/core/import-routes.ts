import { Hono } from 'hono';
import { matchClassName } from '../../shared/csv';
import { parseLooseDate, todayIST } from '../../shared/dates';
import { importInput, type ImportRowInput } from '../../shared/schemas';
import type { ImportResult, ImportRowError, SchoolClass, Section } from '../../shared/types';
import type { AppEnv } from '../env';
import { enrolmentHooks } from '../modules';
import { audit } from './audit';
import { assertBranch, requirePermission } from './auth';
import { notFound, parse } from './errors';

export const importRoutes = new Hono<AppEnv>();

export interface ReadyRow {
  admission_no: string;
  name: string;
  father_name: string;
  mother_name: string;
  phone: string;
  phone2: string;
  address: string;
  dob: string | null;
  gender: string;
  class_id: number;
  section_id: number;
  roll_no: number | null;
  admission_type: 'new' | 'old';
}

export interface ImportContext {
  classes: SchoolClass[];
  /** Sections of the chosen branch. */
  sections: Section[];
  /** Lower-cased admission numbers already in the database. */
  existingAdmissionNos: Set<string>;
  /** `${section_id}|${roll_no}` already used in the session. */
  takenRolls: Set<string>;
  today: string;
}

const GENDERS: Record<string, string> = {
  m: 'male',
  male: 'male',
  boy: 'male',
  b: 'male',
  f: 'female',
  female: 'female',
  girl: 'female',
  g: 'female',
  o: 'other',
  other: 'other',
};

/** Pure check of one chunk of import rows. Every problem is reported with its line number. */
export function validateImportRows(
  rows: ImportRowInput[],
  ctx: ImportContext,
): { ready: (ReadyRow & { line: number })[]; errors: ImportRowError[] } {
  const errors: ImportRowError[] = [];
  const ready: (ReadyRow & { line: number })[] = [];
  const seenAdmission = new Set<string>();
  const seenRolls = new Set<string>();
  const classNames = ctx.classes.map((cl) => cl.name);
  for (const row of rows) {
    const problems: string[] = [];
    if (!row.name) problems.push('Name is empty');

    const className = matchClassName(row.class, classNames);
    const cls = ctx.classes.find((cl) => cl.name === className);
    if (!row.class) problems.push('Class is empty');
    else if (!cls)
      problems.push(`Class "${row.class}" is not known. Use Nursery, KG 1, KG 2 or 1 to 12`);

    const sectionName = (row.section || 'A').toUpperCase();
    const section =
      cls &&
      ctx.sections.find((s) => s.class_id === cls.id && s.name.toUpperCase() === sectionName);
    if (cls && !section) {
      problems.push(
        `Section ${sectionName} does not exist for ${cls.name} in this branch. Add it under Classes and sections first`,
      );
    }

    let roll: number | null = null;
    if (row.roll_no) {
      if (/^\d{1,4}$/.test(row.roll_no) && Number(row.roll_no) > 0) roll = Number(row.roll_no);
      else problems.push(`Roll number "${row.roll_no}" must be a number`);
    }
    if (section && roll !== null) {
      const key = `${section.id}|${roll}`;
      if (ctx.takenRolls.has(key))
        problems.push(`Roll number ${roll} is already used in ${cls!.name} ${section.name}`);
      else if (seenRolls.has(key))
        problems.push(
          `Roll number ${roll} appears twice in ${cls!.name} ${section.name} in this file`,
        );
      seenRolls.add(key);
    }

    const adm = row.admission_no.toLowerCase();
    if (adm) {
      if (ctx.existingAdmissionNos.has(adm))
        problems.push(`Admission number ${row.admission_no} is already in the system`);
      else if (seenAdmission.has(adm))
        problems.push(`Admission number ${row.admission_no} appears twice in this file`);
      seenAdmission.add(adm);
    }

    let dob: string | null = null;
    if (row.dob) {
      dob = parseLooseDate(row.dob);
      if (!dob) problems.push(`Date of birth "${row.dob}" is not a date. Write it like 23/08/2015`);
      else if (dob > ctx.today) problems.push('Date of birth is in the future');
    }

    const gender = row.gender ? GENDERS[row.gender.toLowerCase()] : '';
    if (gender === undefined)
      problems.push(`Gender "${row.gender}" is not known. Use Male, Female or Other`);

    for (const [label, value] of [
      ['Phone', row.phone],
      ['Phone 2', row.phone2],
    ] as const) {
      if (value && !/^[0-9+ -]{0,15}$/.test(value))
        problems.push(`${label} "${value}" can only have digits`);
    }

    const type = row.admission_type.toLowerCase();
    if (type && type !== 'new' && type !== 'old')
      problems.push(`New or old must say New or Old, not "${row.admission_type}"`);

    if (problems.length) {
      errors.push({ line: row.line, message: problems.join('. ') + '.' });
    } else {
      ready.push({
        line: row.line,
        admission_no: row.admission_no,
        name: row.name,
        father_name: row.father_name,
        mother_name: row.mother_name,
        phone: row.phone,
        phone2: row.phone2,
        address: row.address,
        dob,
        gender: gender ?? '',
        class_id: cls!.id,
        section_id: section!.id,
        roll_no: roll,
        admission_type: type === 'old' ? 'old' : 'new',
      });
    }
  }
  return { ready, errors };
}

/**
 * Checks a chunk of rows and, with ?commit=1, saves it. A chunk is saved only when every
 * row in it is correct, so the browser first previews the whole file, then commits.
 */
importRoutes.post('/students/import', requirePermission('students.import'), async (c) => {
  const db = c.env.DB;
  const input = parse(importInput, await c.req.json());
  const commit = c.req.query('commit') === '1';
  assertBranch(c.get('user'), input.branch_id);

  const admissionNos = input.rows.map((r) => r.admission_no).filter(Boolean);
  const [session, classes, sections, existing, rolls, maxNo] = await db.batch([
    db.prepare('SELECT id, name FROM academic_sessions WHERE id = ?').bind(input.session_id),
    db.prepare('SELECT id, name, sort_order FROM classes'),
    db
      .prepare('SELECT id, branch_id, class_id, name, active FROM sections WHERE branch_id = ?')
      .bind(input.branch_id),
    db
      .prepare(
        'SELECT lower(admission_no) AS a FROM students WHERE admission_no IN (SELECT value FROM json_each(?))',
      )
      .bind(JSON.stringify(admissionNos)),
    db
      .prepare(
        'SELECT section_id, roll_no FROM enrolments WHERE session_id = ? AND branch_id = ? AND roll_no IS NOT NULL',
      )
      .bind(input.session_id, input.branch_id),
    db.prepare(
      "SELECT COALESCE(MAX(CAST(admission_no AS INTEGER)), 0) AS n FROM students WHERE admission_no GLOB '[0-9]*'",
    ),
  ]);
  const sessionRow = session!.results[0] as { id: number; name: string } | undefined;
  if (!sessionRow) throw notFound('Session');

  const { ready, errors } = validateImportRows(input.rows, {
    classes: classes!.results as SchoolClass[],
    sections: sections!.results as Section[],
    existingAdmissionNos: new Set((existing!.results as { a: string }[]).map((r) => r.a)),
    takenRolls: new Set(
      (rolls!.results as { section_id: number; roll_no: number }[]).map(
        (r) => `${r.section_id}|${r.roll_no}`,
      ),
    ),
    today: todayIST(),
  });
  if (!commit || errors.length > 0) {
    return c.json<ImportResult>({ errors, valid: ready.length, imported: 0 });
  }

  // Rows without an admission number get the next free numbers.
  let next = Math.max((maxNo!.results[0] as { n: number }).n, input.auto_after);
  for (const row of ready) {
    if (/^\d+$/.test(row.admission_no)) next = Math.max(next, Number(row.admission_no));
  }
  const taken = new Set(ready.map((r) => r.admission_no.toLowerCase()));
  for (const row of ready) {
    if (row.admission_no) continue;
    do next++;
    while (taken.has(String(next)));
    row.admission_no = String(next);
  }
  const json = JSON.stringify(ready);
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO students (admission_no, name, father_name, mother_name, phone, phone2, address, dob, gender, created_at, updated_at)
         SELECT j.value->>'admission_no', j.value->>'name', j.value->>'father_name', j.value->>'mother_name',
                j.value->>'phone', j.value->>'phone2', j.value->>'address', j.value->>'dob', j.value->>'gender', ?2, ?2
           FROM json_each(?1) j`,
      )
      .bind(json, now),
    db
      .prepare(
        `INSERT INTO enrolments (student_id, session_id, branch_id, class_id, section_id, roll_no, admission_type, status, created_at, updated_at)
         SELECT s.id, ?2, ?3, j.value->>'class_id', j.value->>'section_id', j.value->>'roll_no',
                j.value->>'admission_type', 'studying', ?4, ?4
           FROM json_each(?1) j JOIN students s ON s.admission_no = j.value->>'admission_no'`,
      )
      .bind(json, input.session_id, input.branch_id, now),
    audit(c, {
      action: 'create',
      entity: 'student',
      branch_id: input.branch_id,
      summary: `Imported ${ready.length} students into ${sessionRow.name}`,
    }),
    ...enrolmentHooks(c, input.session_id),
  ]);
  return c.json<ImportResult>({ errors: [], valid: ready.length, imported: ready.length });
});
