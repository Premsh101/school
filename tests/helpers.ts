import { env } from 'cloudflare:test';
import { hashPassword } from '../src/worker/core/password';
import app from '../src/worker/index';
import { ensureRates } from '../src/worker/modules/fees/service';

/** A tiny browser: remembers the session cookie between calls. */
export class Client {
  cookie = '';
  async call<T = any>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: T }> {
    const res = await app.request(
      `http://localhost/api${path}`,
      {
        method,
        headers: { 'content-type': 'application/json', cookie: this.cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
    return { status: res.status, data: (await res.json()) as T };
  }
  get = <T = any>(path: string) => this.call<T>('GET', path);
  post = <T = any>(path: string, body?: unknown) => this.call<T>('POST', path, body ?? {});
  put = <T = any>(path: string, body?: unknown) => this.call<T>('PUT', path, body ?? {});
}

export const OWNER = { username: 'owner', password: 'owner-pass-1' };

/**
 * A small school for tests: "Test School" with one branch, Kamalganj (KMG), the 2026-27
 * session, section A everywhere, the printed fee chart, and an admin login "owner".
 * (The real initial school, migration 0003, is tested on its own in initial-school.test.ts.)
 * Returns the admin, signed in to all schools.
 */
export async function setupSchool(): Promise<Client> {
  const db = env.DB;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO settings (key, value) VALUES ('school_name', 'Test School')"),
    db
      .prepare(
        "INSERT INTO branches (name, code, address, phone, active, created_at) VALUES ('Kamalganj', 'KMG', '', '', 1, ?)",
      )
      .bind(now),
    db.prepare(
      "INSERT INTO sections (branch_id, class_id, name) SELECT (SELECT id FROM branches WHERE code = 'KMG'), id, 'A' FROM classes",
    ),
    db
      .prepare(
        "INSERT INTO academic_sessions (name, start_year, start_month, is_current, created_at) VALUES ('2026-27', 2026, 4, 1, ?)",
      )
      .bind(now),
    ...ensureRates(db, '?1', 1),
    db
      .prepare(
        `INSERT INTO users (username, name, password_hash, role, active, must_change_password, created_at, updated_at)
         VALUES (?, 'Owner', ?, 'admin', 1, 0, ?, ?)`,
      )
      .bind(OWNER.username, await hashPassword(OWNER.password), now, now),
  ]);
  return signIn(OWNER.username, OWNER.password);
}

/** Signs in to one school, or to all schools when branchId is null. */
export async function signIn(
  username: string,
  password: string,
  branchId: number | null = null,
): Promise<Client> {
  const client = new Client();
  const res = await client.post('/auth/login', { username, password, branch_id: branchId });
  if (res.status !== 200) throw new Error(`sign-in failed: ${JSON.stringify(res.data)}`);
  return client;
}

/**
 * The admin adds a login, and the person is treated as having already chosen their own
 * password (tests of that first step are in auth.test.ts).
 */
export async function addLogin(
  admin: Client,
  login: { username: string; name: string; role: string; password: string; branch_ids?: number[] },
): Promise<void> {
  const res = await admin.post('/users', { branch_ids: [], ...login });
  if (res.status !== 200) throw new Error(`add login failed: ${JSON.stringify(res.data)}`);
  await env.DB.prepare('UPDATE users SET must_change_password = 0 WHERE username = ?')
    .bind(login.username)
    .run();
}

export async function sectionId(branchId: number, classId: number, name = 'A'): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT id FROM sections WHERE branch_id = ? AND class_id = ? AND name = ?',
  )
    .bind(branchId, classId, name)
    .first<{ id: number }>();
  return row!.id;
}
