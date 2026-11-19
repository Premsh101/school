import { Hono } from 'hono';
import { manageableRoles, type Role } from '../../shared/permissions';
import { userInput } from '../../shared/schemas';
import type { UserRow } from '../../shared/types';
import type { AppEnv, AuthUser } from '../env';
import { audit } from './audit';
import { branchScope, requirePermission } from './auth';
import { AppError, intParam, notFound, parse } from './errors';
import { hashPassword } from './password';

export const userRoutes = new Hono<AppEnv>();
userRoutes.use('/users/*', requirePermission('users.manage'));
userRoutes.use('/users', requirePermission('users.manage'));

type Row = Omit<UserRow, 'branch_ids'> & { branch_ids: string | null };
const toUser = (r: Row): UserRow => ({
  ...r,
  branch_ids: r.branch_ids ? r.branch_ids.split(',').map(Number) : [],
});

/** A principal may only manage accountants, teachers and staff inside their own branches. */
function assertMayManage(actor: AuthUser, role: Role, branchIds: number[]): void {
  if (!manageableRoles(actor.role).includes(role)) {
    throw new AppError(403, 'You cannot add or change a login with this role. Ask the admin.');
  }
  const scope = branchScope(actor);
  if (scope && (branchIds.length === 0 || branchIds.some((b) => !scope.includes(b)))) {
    throw new AppError(403, 'You can only manage logins for your own branch.');
  }
}

const SELECT = `SELECT u.id, u.username, u.name, u.role, u.active,
  (SELECT group_concat(branch_id) FROM user_branches WHERE user_id = u.id) AS branch_ids FROM users u`;

userRoutes.get('/users', async (c) => {
  const actor = c.get('user');
  const { results } = await c.env.DB.prepare(
    `${SELECT} ORDER BY u.active DESC, u.name LIMIT 500`,
  ).all<Row>();
  const scope = branchScope(actor);
  const roles = manageableRoles(actor.role);
  const users = results
    .map(toUser)
    .filter(
      (u) =>
        scope === null ||
        (roles.includes(u.role) &&
          u.branch_ids.length > 0 &&
          u.branch_ids.every((b) => scope.includes(b))),
    );
  return c.json(users);
});

userRoutes.post('/users', async (c) => {
  const db = c.env.DB;
  const input = parse(userInput, await c.req.json());
  assertMayManage(c.get('user'), input.role, input.branch_ids);
  if (!input.password)
    throw new AppError(400, 'Enter a password for the new login.', { password: 'Required' });
  if (input.role !== 'admin' && input.branch_ids.length === 0) {
    throw new AppError(400, 'Choose at least one branch for this login.', {
      branch_ids: 'Required',
    });
  }
  const now = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare(
          'INSERT INTO users (username, name, password_hash, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          input.username,
          input.name,
          await hashPassword(input.password),
          input.role,
          input.active ? 1 : 0,
          now,
          now,
        ),
      audit(c, {
        action: 'create',
        entity: 'user',
        entity_id: 'last',
        summary: `Added login ${input.username} (${input.role})`,
      }),
      db
        .prepare(
          'INSERT INTO user_branches (user_id, branch_id) SELECT (SELECT id FROM users WHERE username = ?1), value FROM json_each(?2)',
        )
        .bind(input.username, JSON.stringify(input.branch_ids)),
    ]);
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint/i.test(e.message)) {
      throw new AppError(409, `Username ${input.username} is already taken. Choose another.`, {
        username: 'Already taken',
      });
    }
    if (e instanceof Error && /FOREIGN KEY/i.test(e.message)) throw notFound('Branch');
    throw e;
  }
  return c.json({ ok: true });
});

userRoutes.put('/users/:id', async (c) => {
  const db = c.env.DB;
  const actor = c.get('user');
  const id = intParam(c.req.param('id'), 'Login');
  const input = parse(userInput, await c.req.json());
  const existingRow = await db.prepare(`${SELECT} WHERE u.id = ?`).bind(id).first<Row>();
  if (!existingRow) throw notFound('Login');
  const existing = toUser(existingRow);
  // Must be allowed to manage the login both as it is now and as it will be.
  assertMayManage(actor, existing.role, existing.branch_ids);
  assertMayManage(actor, input.role, input.branch_ids);
  if (id === actor.id && (input.role !== actor.role || !input.active)) {
    throw new AppError(400, 'You cannot change your own role or switch off your own login.');
  }
  if (input.role !== 'admin' && input.branch_ids.length === 0) {
    throw new AppError(400, 'Choose at least one branch for this login.', {
      branch_ids: 'Required',
    });
  }
  const now = new Date().toISOString();
  const statements = [
    db
      .prepare(
        'UPDATE users SET username = ?, name = ?, role = ?, active = ?, updated_at = ? WHERE id = ?',
      )
      .bind(input.username, input.name, input.role, input.active ? 1 : 0, now, id),
    db.prepare('DELETE FROM user_branches WHERE user_id = ?').bind(id),
    db
      .prepare('INSERT INTO user_branches (user_id, branch_id) SELECT ?1, value FROM json_each(?2)')
      .bind(id, JSON.stringify(input.branch_ids)),
    audit(c, {
      action: 'update',
      entity: 'user',
      entity_id: id,
      summary: `Edited login ${input.username}${input.password ? ' and reset password' : ''}`,
      details: { role: input.role, active: input.active, branch_ids: input.branch_ids },
    }),
  ];
  if (input.password) {
    statements.push(
      db
        .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .bind(await hashPassword(input.password), id),
    );
  }
  // A new password, or switching the login off, signs that person out everywhere.
  // An admin changing their own password here stays signed in on this device only.
  if (input.password && id === actor.id) {
    statements.push(
      db
        .prepare('DELETE FROM auth_sessions WHERE user_id = ? AND id <> ?')
        .bind(id, actor.session_id),
    );
  } else if (input.password || !input.active) {
    statements.push(db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(id));
  }
  try {
    await db.batch(statements);
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint/i.test(e.message)) {
      throw new AppError(409, `Username ${input.username} is already taken. Choose another.`, {
        username: 'Already taken',
      });
    }
    if (e instanceof Error && /FOREIGN KEY/i.test(e.message)) throw notFound('Branch');
    throw e;
  }
  return c.json({ ok: true });
});
