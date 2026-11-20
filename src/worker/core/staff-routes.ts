import { Hono } from 'hono';
import { staffInput } from '../../shared/schemas';
import type { StaffRow } from '../../shared/types';
import type { AppEnv } from '../env';
import { audit } from './audit';
import { assertBranch, requirePermission, scopeSql } from './auth';
import { AppError, intParam, notFound, parse } from './errors';

export const staffRoutes = new Hono<AppEnv>();

staffRoutes.get('/staff', requirePermission('staff.view'), async (c) => {
  const user = c.get('user');
  const branchId = Number(c.req.query('branch_id')) || null;
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.phone, s.designation, s.branch_id, s.joining_date, s.is_teaching,
            s.user_id, u.username, s.active
       FROM staff s LEFT JOIN users u ON u.id = s.user_id
      WHERE (?1 IS NULL OR s.branch_id = ?1) ${scopeSql(user, 's.branch_id')}
      ORDER BY s.active DESC, s.name LIMIT 500`,
  )
    .bind(branchId)
    .all<StaffRow>();
  return c.json(results);
});

const linkError = (e: unknown) => {
  if (e instanceof Error && /UNIQUE constraint/i.test(e.message)) {
    return new AppError(409, 'That login is already linked to another staff member.', {
      user_id: 'Already linked',
    });
  }
  if (e instanceof Error && /FOREIGN KEY/i.test(e.message)) return notFound('Branch or login');
  return e;
};

staffRoutes.post('/staff', requirePermission('staff.edit'), async (c) => {
  const db = c.env.DB;
  const input = parse(staffInput, await c.req.json());
  assertBranch(c.get('user'), input.branch_id);
  const now = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO staff (name, phone, designation, branch_id, joining_date, is_teaching, user_id, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.name,
          input.phone,
          input.designation,
          input.branch_id,
          input.joining_date,
          input.is_teaching ? 1 : 0,
          input.user_id,
          input.active ? 1 : 0,
          now,
          now,
        ),
      audit(c, {
        action: 'create',
        entity: 'staff',
        entity_id: 'last',
        branch_id: input.branch_id,
        summary: `Added staff member ${input.name}`,
      }),
    ]);
  } catch (e) {
    throw linkError(e);
  }
  return c.json({ ok: true });
});

staffRoutes.put('/staff/:id', requirePermission('staff.edit'), async (c) => {
  const db = c.env.DB;
  const id = intParam(c.req.param('id'), 'Staff member');
  const input = parse(staffInput, await c.req.json());
  const existing = await db
    .prepare('SELECT branch_id FROM staff WHERE id = ?')
    .bind(id)
    .first<{ branch_id: number }>();
  if (!existing) throw notFound('Staff member');
  assertBranch(c.get('user'), existing.branch_id);
  assertBranch(c.get('user'), input.branch_id);
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE staff SET name = ?, phone = ?, designation = ?, branch_id = ?, joining_date = ?,
                  is_teaching = ?, user_id = ?, active = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(
          input.name,
          input.phone,
          input.designation,
          input.branch_id,
          input.joining_date,
          input.is_teaching ? 1 : 0,
          input.user_id,
          input.active ? 1 : 0,
          new Date().toISOString(),
          id,
        ),
      audit(c, {
        action: 'update',
        entity: 'staff',
        entity_id: id,
        branch_id: input.branch_id,
        summary: `Edited staff member ${input.name}`,
        details: input,
      }),
    ]);
  } catch (e) {
    throw linkError(e);
  }
  return c.json({ ok: true });
});
