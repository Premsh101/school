import { Hono } from 'hono';
import { todayIST } from '../../shared/dates';
import { CORE_PERMISSIONS, can, seesAllBranches } from '../../shared/permissions';
import { branchSwitchInput, loginInput, passwordChangeInput } from '../../shared/schemas';
import type { AcademicSession, Bootstrap, Branch, SchoolClass, Section } from '../../shared/types';
import type { AppEnv, Ctx } from '../env';
import { modules } from '../modules';
import { audit } from './audit';
import {
  clearSessionCookie,
  currentUser,
  requireUser,
  schoolChoiceProblem,
  scopeSql,
  startSession,
} from './auth';
import { AppError, notFound, parse } from './errors';
import { hashPassword, needsRehash, verifyPassword } from './password';

export const MAX_FAILS_PER_USERNAME = 5;
export const MAX_FAILS_PER_IP = 30;
const WINDOW_SECONDS = 15 * 60;

// There is no sign-up. The first admin login comes with the app (migration 0003) and the
// admin creates every other login under Logins.
export const authRoutes = new Hono<AppEnv>();

/** Everything the app shell needs in one call: who is signed in and the school's structure. */
authRoutes.get('/bootstrap', async (c) => {
  const db = c.env.DB;
  const user = await currentUser(c);
  const base: Bootstrap = {
    needs_setup: false,
    user: null,
    login_branches: [],
    school: { name: '', address: '', logo: '' },
    branches: [],
    my_branches: [],
    sessions: [],
    classes: [],
    sections: [],
    modules: {},
    today: todayIST(),
  };
  if (!user) {
    const [users, settings, branches] = await db.batch<{
      n?: number;
      key?: string;
      value?: string;
      id?: number;
      name?: string;
    }>([
      db.prepare('SELECT COUNT(*) AS n FROM users'),
      db.prepare("SELECT key, value FROM settings WHERE key IN ('school_name', 'logo')"),
      db.prepare('SELECT id, name FROM branches WHERE active = 1 ORDER BY id'),
    ]);
    const map = Object.fromEntries(settings!.results.map((r) => [r.key, r.value]));
    return c.json<Bootstrap>({
      ...base,
      needs_setup: users!.results[0]!.n === 0,
      login_branches: branches!.results.map((b) => ({ id: b.id!, name: b.name! })),
      school: { name: map.school_name ?? '', address: '', logo: map.logo ?? '' },
    });
  }
  const mine = seesAllBranches(user.role)
    ? ''
    : ` AND b.id IN (${user.assigned_branch_ids.map(Number).join(',') || 0})`;
  const branchCols = 'SELECT id, name, code, address, phone, active FROM branches b WHERE 1';
  const [settings, branches, myBranches, sessions, classes, sections] = await db.batch([
    db.prepare('SELECT key, value FROM settings'),
    db.prepare(`${branchCols} ${scopeSql(user, 'b.id')} ORDER BY id`),
    db.prepare(`${branchCols} ${mine} ORDER BY id`),
    db.prepare(
      'SELECT id, name, start_year, start_month, is_current FROM academic_sessions ORDER BY start_year DESC',
    ),
    db.prepare('SELECT id, name, sort_order FROM classes ORDER BY sort_order'),
    db.prepare(
      `SELECT id, branch_id, class_id, name, active FROM sections s WHERE 1 ${scopeSql(user, 's.branch_id')} ORDER BY class_id, name`,
    ),
  ]);
  const map = Object.fromEntries(
    (settings!.results as { key: string; value: string }[]).map((r) => [r.key, r.value]),
  );
  const permissions = [...CORE_PERMISSIONS, ...modules.flatMap((m) => m.permissions)].filter((p) =>
    can(user.role, p),
  );
  return c.json<Bootstrap>({
    ...base,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      permissions,
      branch_id: user.session_branch_id,
      all_schools: seesAllBranches(user.role),
      must_change_password: user.must_change_password,
    },
    school: {
      name: map.school_name ?? '',
      address: map.school_address ?? '',
      logo: map.logo ?? '',
    },
    branches: branches!.results as Branch[],
    my_branches: myBranches!.results as Branch[],
    sessions: sessions!.results as AcademicSession[],
    classes: classes!.results as SchoolClass[],
    sections: sections!.results as Section[],
    modules: Object.fromEntries(modules.map((m) => [m.id, map[`module.${m.id}`] !== '0'])),
  });
});

/** Checks the chosen school exists, is open and is one the person may work in. */
async function checkSchoolChoice(
  c: Ctx,
  person: { id: number; role: Parameters<typeof seesAllBranches>[0] },
  branchId: number | null,
): Promise<void> {
  const db = c.env.DB;
  const [branch, assigned] = await db.batch([
    db.prepare('SELECT active FROM branches WHERE id = ?').bind(branchId ?? 0),
    db.prepare('SELECT branch_id FROM user_branches WHERE user_id = ?').bind(person.id),
  ]);
  if (branchId !== null) {
    const row = branch!.results[0] as { active: number } | undefined;
    if (!row) throw notFound('School');
    if (!row.active) throw new AppError(400, 'This school is closed. Choose another school.');
  }
  const ids = (assigned!.results as { branch_id: number }[]).map((r) => r.branch_id);
  const problem = schoolChoiceProblem(person.role, ids, branchId);
  if (problem) throw new AppError(403, problem, { branch_id: problem });
}

authRoutes.post('/auth/login', async (c) => {
  const db = c.env.DB;
  const input = parse(loginInput, await c.req.json());
  const username = input.username.toLowerCase();
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  const now = Math.floor(Date.now() / 1000);
  const since = now - WINDOW_SECONDS;
  const [byName, byIp, userRows] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        'SELECT COUNT(*) AS n, MIN(at) AS first FROM login_attempts WHERE username = ? AND at > ?',
      )
      .bind(username, since),
    db
      .prepare('SELECT COUNT(*) AS n, MIN(at) AS first FROM login_attempts WHERE ip = ? AND at > ?')
      .bind(ip, since),
    db
      .prepare('SELECT id, name, role, password_hash, active FROM users WHERE username = ?')
      .bind(username),
  ]);
  const nameFails = byName!.results[0] as { n: number; first: number | null };
  const ipFails = byIp!.results[0] as { n: number; first: number | null };
  if (nameFails.n >= MAX_FAILS_PER_USERNAME || ipFails.n >= MAX_FAILS_PER_IP) {
    const first = (nameFails.n >= MAX_FAILS_PER_USERNAME ? nameFails.first : ipFails.first) ?? now;
    const minutes = Math.max(1, Math.ceil((first + WINDOW_SECONDS - now) / 60));
    throw new AppError(
      429,
      `Too many wrong attempts. Wait ${minutes} minutes and try again, or ask the admin to reset your password.`,
    );
  }
  const user = userRows!.results[0] as
    { id: number; name: string; role: 'admin'; password_hash: string; active: number } | undefined;
  // Unknown usernames skip the hash; the attempt limit above is what stops guessing.
  const ok = user ? await verifyPassword(input.password, user.password_hash) : false;
  if (!user || !ok || !user.active) {
    await db.batch([
      db
        .prepare('INSERT INTO login_attempts (username, ip, at) VALUES (?, ?, ?)')
        .bind(username, ip, now),
      db.prepare('DELETE FROM login_attempts WHERE at < ?').bind(now - 24 * 60 * 60),
    ]);
    if (user && ok)
      throw new AppError(403, 'This login has been switched off. Ask the admin to switch it on.');
    throw new AppError(401, 'Wrong username or password. Check both and try again.');
  }
  await checkSchoolChoice(c, user, input.branch_id);
  const statements = [
    await startSession(c, user.id, input.branch_id),
    db.prepare('DELETE FROM login_attempts WHERE username = ?').bind(username),
    db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').bind(now),
  ];
  if (needsRehash(user.password_hash)) {
    statements.push(
      db
        .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .bind(await hashPassword(input.password), user.id),
    );
  }
  await db.batch(statements);
  return c.json({ ok: true });
});

/** Switches the school being worked in, without signing in again. */
authRoutes.post('/auth/school', requireUser, async (c) => {
  const user = c.get('user');
  const input = parse(branchSwitchInput, await c.req.json());
  await checkSchoolChoice(c, user, input.branch_id);
  await c.env.DB.prepare('UPDATE auth_sessions SET branch_id = ? WHERE id = ?')
    .bind(input.branch_id, user.session_id)
    .run();
  return c.json({ ok: true });
});

authRoutes.post('/auth/logout', async (c) => {
  const user = await currentUser(c);
  if (user)
    await c.env.DB.prepare('DELETE FROM auth_sessions WHERE id = ?').bind(user.session_id).run();
  clearSessionCookie(c);
  return c.json({ ok: true });
});

/** Changing the password signs the user out everywhere else. */
authRoutes.post('/auth/password', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const input = parse(passwordChangeInput, await c.req.json());
  const row = await db
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(input.current_password, row.password_hash))) {
    throw new AppError(400, 'Your current password is not right.', {
      current_password: 'Wrong password',
    });
  }
  if (input.current_password === input.new_password) {
    throw new AppError(400, 'Choose a new password that is different from the old one.', {
      new_password: 'Same as the old password',
    });
  }
  await db.batch([
    db
      .prepare(
        'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?',
      )
      .bind(await hashPassword(input.new_password), new Date().toISOString(), user.id),
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(user.id),
    await startSession(c, user.id, user.session_branch_id),
    audit(c, {
      action: 'update',
      entity: 'user',
      entity_id: user.id,
      summary: 'Changed own password',
    }),
  ]);
  return c.json({ ok: true });
});
