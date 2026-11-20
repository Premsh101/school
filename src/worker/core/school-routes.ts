import { Hono } from 'hono';
import { sessionName } from '../../shared/dates';
import { can } from '../../shared/permissions';
import {
  branchInput,
  sectionInput,
  sessionInput,
  settingsInput,
  subjectInput,
} from '../../shared/schemas';
import type { HomeSummary, Subject } from '../../shared/types';
import type { AppEnv } from '../env';
import { modules } from '../modules';
import { audit } from './audit';
import { assertBranch, requirePermission, scopeSql } from './auth';
import { AppError, intParam, notFound, parse } from './errors';

export const schoolRoutes = new Hono<AppEnv>();

const isUniqueError = (e: unknown) => e instanceof Error && /UNIQUE constraint/i.test(e.message);

schoolRoutes.get('/home', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  // Counts are only for people who may see the lists they summarise.
  const seeStudents = can(user.role, 'students.view');
  const seeStaff = can(user.role, 'staff.view');
  const [students, staff] = await db.batch([
    db
      .prepare(
        `SELECT e.branch_id, COUNT(*) AS count FROM enrolments e
          JOIN academic_sessions s ON s.id = e.session_id AND s.is_current = 1
         WHERE e.status = 'studying' AND ?1 = 1 ${scopeSql(user, 'e.branch_id')} GROUP BY e.branch_id`,
      )
      .bind(seeStudents ? 1 : 0),
    db
      .prepare(
        `SELECT branch_id, COUNT(*) AS count FROM staff WHERE active = 1 AND ?1 = 1 ${scopeSql(user, 'branch_id')} GROUP BY branch_id`,
      )
      .bind(seeStaff ? 1 : 0),
  ]);
  return c.json<HomeSummary>({
    students: students!.results as HomeSummary['students'],
    staff: staff!.results as HomeSummary['staff'],
  });
});

// ── Branches ────────────────────────────────────────────────────────────────

schoolRoutes.post('/branches', requirePermission('school.manage'), async (c) => {
  const db = c.env.DB;
  const input = parse(branchInput, await c.req.json());
  try {
    await db.batch([
      db
        .prepare(
          'INSERT INTO branches (name, code, address, phone, active, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(
          input.name,
          input.code,
          input.address,
          input.phone,
          input.active ? 1 : 0,
          new Date().toISOString(),
        ),
      audit(c, {
        action: 'create',
        entity: 'branch',
        entity_id: 'last',
        summary: `Added branch ${input.name} (${input.code})`,
      }),
      // Every class starts with section A so students can be added straight away.
      db
        .prepare(
          "INSERT INTO sections (branch_id, class_id, name) SELECT (SELECT id FROM branches WHERE code = ?), id, 'A' FROM classes",
        )
        .bind(input.code),
    ]);
  } catch (e) {
    if (isUniqueError(e))
      throw new AppError(
        409,
        `Short code ${input.code} is already used by another branch. Choose a different one.`,
        { code: 'Already used' },
      );
    throw e;
  }
  return c.json({ ok: true });
});

schoolRoutes.put('/branches/:id', requirePermission('school.manage'), async (c) => {
  const db = c.env.DB;
  const id = intParam(c.req.param('id'), 'Branch');
  const input = parse(branchInput, await c.req.json());
  try {
    const [res] = await db.batch([
      db
        .prepare(
          'UPDATE branches SET name = ?, code = ?, address = ?, phone = ?, active = ? WHERE id = ?',
        )
        .bind(input.name, input.code, input.address, input.phone, input.active ? 1 : 0, id),
      audit(c, {
        action: 'update',
        entity: 'branch',
        entity_id: id,
        branch_id: id,
        summary: `Edited branch ${input.name}`,
        details: input,
      }),
    ]);
    if (!res!.meta.changes) throw notFound('Branch');
  } catch (e) {
    if (isUniqueError(e))
      throw new AppError(
        409,
        `Short code ${input.code} is already used by another branch. Choose a different one.`,
        { code: 'Already used' },
      );
    throw e;
  }
  return c.json({ ok: true });
});

// ── Academic sessions ───────────────────────────────────────────────────────

schoolRoutes.post('/sessions', requirePermission('school.manage'), async (c) => {
  const db = c.env.DB;
  const input = parse(sessionInput, await c.req.json());
  const name = sessionName(input.start_year);
  const previous = await db
    .prepare(
      'SELECT id FROM academic_sessions WHERE start_year < ? ORDER BY start_year DESC LIMIT 1',
    )
    .bind(input.start_year)
    .first<{ id: number }>();
  try {
    await db.batch([
      db
        .prepare(
          'INSERT INTO academic_sessions (name, start_year, start_month, is_current, created_at) VALUES (?, ?, ?, 0, ?)',
        )
        .bind(name, input.start_year, input.start_month, new Date().toISOString()),
      audit(c, {
        action: 'create',
        entity: 'session',
        entity_id: 'last',
        summary: `Opened session ${name}`,
      }),
      // Modules carry their own data forward, e.g. fees copies the rate chart.
      ...modules.flatMap(
        (m) => m.onSessionOpened?.(c, previous, { start_year: input.start_year }) ?? [],
      ),
    ]);
  } catch (e) {
    if (isUniqueError(e)) throw new AppError(409, `Session ${name} already exists.`);
    throw e;
  }
  return c.json({ ok: true, name });
});

schoolRoutes.post('/sessions/:id/current', requirePermission('school.manage'), async (c) => {
  const db = c.env.DB;
  const id = intParam(c.req.param('id'), 'Session');
  const session = await db
    .prepare('SELECT name FROM academic_sessions WHERE id = ?')
    .bind(id)
    .first<{ name: string }>();
  if (!session) throw notFound('Session');
  await db.batch([
    db.prepare('UPDATE academic_sessions SET is_current = (id = ?)').bind(id),
    audit(c, {
      action: 'update',
      entity: 'session',
      entity_id: id,
      summary: `Made ${session.name} the current session`,
    }),
  ]);
  return c.json({ ok: true });
});

// ── Sections ────────────────────────────────────────────────────────────────

schoolRoutes.post('/sections', requirePermission('structure.edit'), async (c) => {
  const db = c.env.DB;
  const input = parse(sectionInput, await c.req.json());
  assertBranch(c.get('user'), input.branch_id);
  try {
    await db.batch([
      db
        .prepare('INSERT INTO sections (branch_id, class_id, name) VALUES (?, ?, ?)')
        .bind(input.branch_id, input.class_id, input.name),
      audit(c, {
        action: 'create',
        entity: 'section',
        entity_id: 'last',
        branch_id: input.branch_id,
        summary: `Added section ${input.name}`,
        details: input,
      }),
    ]);
  } catch (e) {
    if (isUniqueError(e))
      throw new AppError(409, `Section ${input.name} already exists for this class.`);
    if (e instanceof Error && /FOREIGN KEY/i.test(e.message)) throw notFound('Branch or class');
    throw e;
  }
  return c.json({ ok: true });
});

/** A section with students can't be removed, only switched off so it stops showing in forms. */
schoolRoutes.put('/sections/:id/active', requirePermission('structure.edit'), async (c) => {
  const db = c.env.DB;
  const id = intParam(c.req.param('id'), 'Section');
  const { active } = (await c.req.json()) as { active?: boolean };
  const section = await db
    .prepare('SELECT branch_id, name FROM sections WHERE id = ?')
    .bind(id)
    .first<{ branch_id: number; name: string }>();
  if (!section) throw notFound('Section');
  assertBranch(c.get('user'), section.branch_id);
  await db.batch([
    db.prepare('UPDATE sections SET active = ? WHERE id = ?').bind(active ? 1 : 0, id),
    audit(c, {
      action: 'update',
      entity: 'section',
      entity_id: id,
      branch_id: section.branch_id,
      summary: `Switched section ${section.name} ${active ? 'on' : 'off'}`,
    }),
  ]);
  return c.json({ ok: true });
});

// ── Subjects (used from the lectures module onwards) ────────────────────────

schoolRoutes.get('/subjects', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, code, active FROM subjects ORDER BY name',
  ).all<Subject>();
  return c.json(results);
});

schoolRoutes.post('/subjects', requirePermission('school.manage'), async (c) => {
  const input = parse(subjectInput, await c.req.json());
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO subjects (name, code, active) VALUES (?, ?, ?)').bind(
        input.name,
        input.code,
        input.active ? 1 : 0,
      ),
      audit(c, {
        action: 'create',
        entity: 'subject',
        entity_id: 'last',
        summary: `Added subject ${input.name}`,
      }),
    ]);
  } catch (e) {
    if (isUniqueError(e)) throw new AppError(409, `Subject ${input.name} already exists.`);
    throw e;
  }
  return c.json({ ok: true });
});

schoolRoutes.put('/subjects/:id', requirePermission('school.manage'), async (c) => {
  const id = intParam(c.req.param('id'), 'Subject');
  const input = parse(subjectInput, await c.req.json());
  try {
    const [res] = await c.env.DB.batch([
      c.env.DB.prepare('UPDATE subjects SET name = ?, code = ?, active = ? WHERE id = ?').bind(
        input.name,
        input.code,
        input.active ? 1 : 0,
        id,
      ),
      audit(c, {
        action: 'update',
        entity: 'subject',
        entity_id: id,
        summary: `Edited subject ${input.name}`,
      }),
    ]);
    if (!res!.meta.changes) throw notFound('Subject');
  } catch (e) {
    if (isUniqueError(e)) throw new AppError(409, `Subject ${input.name} already exists.`);
    throw e;
  }
  return c.json({ ok: true });
});

// ── Settings ────────────────────────────────────────────────────────────────

schoolRoutes.put('/settings', requirePermission('school.manage'), async (c) => {
  const db = c.env.DB;
  const input = parse(settingsInput, await c.req.json());
  const set = (key: string, value: string) =>
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, value);
  const statements: D1PreparedStatement[] = [];
  if (input.school_name !== undefined) statements.push(set('school_name', input.school_name));
  if (input.school_address !== undefined)
    statements.push(set('school_address', input.school_address));
  if (input.logo !== undefined) statements.push(set('logo', input.logo));
  for (const [id, on] of Object.entries(input.modules ?? {})) {
    if (!modules.some((m) => m.id === id))
      throw new AppError(400, `There is no module called ${id}.`);
    statements.push(set(`module.${id}`, on ? '1' : '0'));
  }
  if (statements.length === 0) return c.json({ ok: true });
  const { logo, ...rest } = input;
  statements.push(
    audit(c, {
      action: 'update',
      entity: 'settings',
      summary: 'Changed school settings',
      details: { ...rest, logo: logo === undefined ? undefined : logo ? 'changed' : 'removed' },
    }),
  );
  await db.batch(statements);
  return c.json({ ok: true });
});
