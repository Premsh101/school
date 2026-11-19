import { Hono } from 'hono';
import { sessionName, todayIST } from '../../shared/dates';
import { CORE_PERMISSIONS, can } from '../../shared/permissions';
import { loginInput, passwordChangeInput, setupInput } from '../../shared/schemas';
import type { AcademicSession, Bootstrap, Branch, SchoolClass, Section } from '../../shared/types';
import type { AppEnv } from '../env';
import { modules } from '../modules';
import { audit } from './audit';
import { clearSessionCookie, currentUser, requireUser, scopeSql, startSession } from './auth';
import { AppError, parse } from './errors';
import { hashPassword, needsRehash, verifyPassword } from './password';

export const MAX_FAILS_PER_USERNAME = 5;
export const MAX_FAILS_PER_IP = 30;
const WINDOW_SECONDS = 15 * 60;

export const authRoutes = new Hono<AppEnv>();

/** Everything the app shell needs in one call: who is signed in and the school's structure. */
authRoutes.get('/bootstrap', async (c) => {
  const db = c.env.DB;
  const user = await currentUser(c);
  const base: Bootstrap = {
    needs_setup: false,
    user: null,
    school: { name: '', address: '', logo: '' },
    branches: [],
    sessions: [],
    classes: [],
    sections: [],
    modules: {},
    today: todayIST(),
  };
  if (!user) {
    const [users, settings] = await db.batch<{ n?: number; key?: string; value?: string }>([
      db.prepare('SELECT COUNT(*) AS n FROM users'),
      db.prepare("SELECT key, value FROM settings WHERE key IN ('school_name', 'logo')"),
    ]);
    const map = Object.fromEntries(settings!.results.map((r) => [r.key, r.value]));
    return c.json<Bootstrap>({
      ...base,
      needs_setup: users!.results[0]!.n === 0,
      school: { name: map.school_name ?? '', address: '', logo: map.logo ?? '' },
    });
  }
  const [settings, branches, sessions, classes, sections] = await db.batch([
    db.prepare('SELECT key, value FROM settings'),
    db.prepare(
      `SELECT id, name, code, address, phone, active FROM branches b WHERE 1 ${scopeSql(user, 'b.id')} ORDER BY id`,
    ),
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
  const allBranches = branches!.results as Branch[];
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
      branch_ids: allBranches.map((b) => b.id),
    },
    school: {
      name: map.school_name ?? '',
      address: map.school_address ?? '',
      logo: map.logo ?? '',
    },
    branches: allBranches,
    sessions: sessions!.results as AcademicSession[],
    classes: classes!.results as SchoolClass[],
    sections: sections!.results as Section[],
    modules: Object.fromEntries(modules.map((m) => [m.id, map[`module.${m.id}`] !== '0'])),
  });
});

/** One-time setup: creates the owner, the first branch and the first session. Closed afterwards. */
authRoutes.post('/setup', async (c) => {
  const db = c.env.DB;
  const input = parse(setupInput, await c.req.json());
  const existing = await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  if (existing!.n > 0) throw new AppError(403, 'Setup is already done. Please sign in.');
  const now = new Date().toISOString();
  const hash = await hashPassword(input.password);
  const [userInsert] = await db.batch([
    db
      .prepare(
        // The NOT EXISTS guard keeps setup one-time even if two people submit it together.
        `INSERT INTO users (username, name, password_hash, role, active, created_at, updated_at)
         SELECT ?, ?, ?, 'admin', 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)`,
      )
      .bind(input.username, input.owner_name, hash, now, now),
    db
      .prepare(
        'INSERT INTO branches (name, code, address, phone, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      )
      .bind(input.branch.name, input.branch.code, input.branch.address, input.branch.phone, now),
    db.prepare(
      "INSERT INTO sections (branch_id, class_id, name) SELECT (SELECT MAX(id) FROM branches), id, 'A' FROM classes",
    ),
    db
      .prepare(
        'INSERT INTO academic_sessions (name, start_year, start_month, is_current, created_at) VALUES (?, ?, 4, 1, ?)',
      )
      .bind(sessionName(input.session_start_year), input.session_start_year, now),
    db
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('school_name', ?)")
      .bind(input.school_name),
    db.prepare("DELETE FROM settings WHERE key LIKE 'restore_token%'"),
    db
      .prepare(
        `INSERT INTO audit_log (at, user_id, user_name, action, entity, summary)
         VALUES (?, 1, ?, 'create', 'school', 'School set up')`,
      )
      .bind(now, input.owner_name),
  ]);
  if (!userInsert!.meta.changes) throw new AppError(403, 'Setup is already done. Please sign in.');
  const owner = await db
    .prepare('SELECT id FROM users WHERE username = ?')
    .bind(input.username)
    .first<{ id: number }>();
  await (await startSession(c, owner!.id)).run();
  return c.json({ ok: true });
});

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
      .prepare('SELECT id, name, password_hash, active FROM users WHERE username = ?')
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
    { id: number; name: string; password_hash: string; active: number } | undefined;
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
  const statements = [
    await startSession(c, user.id),
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
  await db.batch([
    db
      .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .bind(await hashPassword(input.new_password), new Date().toISOString(), user.id),
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(user.id),
    await startSession(c, user.id),
    audit(c, {
      action: 'update',
      entity: 'user',
      entity_id: user.id,
      summary: 'Changed own password',
    }),
  ]);
  return c.json({ ok: true });
});
