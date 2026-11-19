import { env } from 'cloudflare:test';
import app from '../src/worker/index';

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

/** Runs first-time setup (branch KMG, session 2026-27) and returns the signed-in owner. */
export async function setupSchool(): Promise<Client> {
  const owner = new Client();
  const res = await owner.post('/setup', {
    school_name: 'Test School',
    owner_name: 'Owner',
    ...OWNER,
    branch: { name: 'Kamalganj', code: 'KMG' },
    session_start_year: 2026,
  });
  if (res.status !== 200) throw new Error(`setup failed: ${JSON.stringify(res.data)}`);
  return owner;
}

export async function signIn(username: string, password: string): Promise<Client> {
  const client = new Client();
  const res = await client.post('/auth/login', { username, password });
  if (res.status !== 200) throw new Error(`sign-in failed: ${JSON.stringify(res.data)}`);
  return client;
}

export async function sectionId(branchId: number, classId: number, name = 'A'): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT id FROM sections WHERE branch_id = ? AND class_id = ? AND name = ?',
  )
    .bind(branchId, classId, name)
    .first<{ id: number }>();
  return row!.id;
}
