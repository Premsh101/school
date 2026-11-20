import { Hono } from 'hono';
import { ROLE_LABELS, seesAllBranches } from '../../shared/permissions';
import { userInput, type UserInput } from '../../shared/schemas';
import type { UserRow } from '../../shared/types';
import type { AppEnv } from '../env';
import { audit } from './audit';
import { requirePermission } from './auth';
import { AppError, intParam, notFound, parse } from './errors';
import { hashPassword } from './password';

// Logins are created only here, by the admin. There is no sign-up.
export const userRoutes = new Hono<AppEnv>();
userRoutes.use('/users/*', requirePermission('users.manage'));
userRoutes.use('/users', requirePermission('users.manage'));

type Row = Omit<UserRow, 'branch_ids'> & { branch_ids: string | null };
const toUser = (r: Row): UserRow => ({
  ...r,
  branch_ids: r.branch_ids ? r.branch_ids.split(',').map(Number) : [],
});

const SELECT = `SELECT u.id, u.username, u.name, u.role, u.active, u.must_change_password,
  (SELECT group_concat(branch_id) FROM user_branches WHERE user_id = u.id) AS branch_ids FROM users u`;

/** Admin and management work in every school, so only accountants are given schools. */
function schoolsFor(input: UserInput): number[] {
  if (seesAllBranches(input.role)) return [];
  if (input.branch_ids.length === 0) {
    throw new AppError(400, 'Tick at least one school for this accountant.', {
      branch_ids: 'Required',
    });
  }
  return input.branch_ids;
}

const uniqueError = (e: unknown, username: string) => {
  if (e instanceof Error && /UNIQUE constraint/i.test(e.message)) {
    return new AppError(409, `Username ${username} is already taken. Choose another.`, {
      username: 'Already taken',
    });
  }
  if (e instanceof Error && /FOREIGN KEY/i.test(e.message)) return notFound('School');
  return e;
};

userRoutes.get('/users', async (c) => {
  const { results } = await c.env.DB.prepare(
    `${SELECT} ORDER BY u.active DESC, u.name LIMIT 500`,
  ).all<Row>();
  return c.json(results.map(toUser));
});

userRoutes.post('/users', async (c) => {
  const db = c.env.DB;
  const input = parse(userInput, await c.req.json());
  if (!input.password)
    throw new AppError(400, 'Enter a first password for the new login.', { password: 'Required' });
  const schools = schoolsFor(input);
  const now = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare(
          // must_change_password = 1: the person chooses their own password at first sign-in.
          `INSERT INTO users (username, name, password_hash, role, active, must_change_password, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
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
        summary: `Added login ${input.username} (${ROLE_LABELS[input.role]})`,
      }),
      db
        .prepare(
          'INSERT INTO user_branches (user_id, branch_id) SELECT (SELECT id FROM users WHERE username = ?1), value FROM json_each(?2)',
        )
        .bind(input.username, JSON.stringify(schools)),
    ]);
  } catch (e) {
    throw uniqueError(e, input.username);
  }
  return c.json({ ok: true });
});

userRoutes.put('/users/:id', async (c) => {
  const db = c.env.DB;
  const actor = c.get('user');
  const id = intParam(c.req.param('id'), 'Login');
  const input = parse(userInput, await c.req.json());
  const existing = await db.prepare(`${SELECT} WHERE u.id = ?`).bind(id).first<Row>();
  if (!existing) throw notFound('Login');
  const self = id === actor.id;
  if (self && (input.role !== actor.role || !input.active)) {
    throw new AppError(400, 'You cannot change your own role or switch off your own login.');
  }
  const schools = schoolsFor(input);
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
      .bind(id, JSON.stringify(schools)),
    audit(c, {
      action: 'update',
      entity: 'user',
      entity_id: id,
      summary: `Edited login ${input.username}${input.password ? ' and reset password' : ''}`,
      details: { role: input.role, active: input.active, branch_ids: schools },
    }),
  ];
  if (input.password) {
    statements.push(
      db
        // Someone else's reset password is only a first password: they must choose their own.
        .prepare('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?')
        .bind(await hashPassword(input.password), self ? 0 : 1, id),
    );
  }
  // A new password, or switching the login off, signs that person out everywhere.
  // An admin changing their own password here stays signed in on this device only.
  if (input.password && self) {
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
    throw uniqueError(e, input.username);
  }
  return c.json({ ok: true });
});
