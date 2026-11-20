import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, verifyPassword } from '../src/worker/core/password';
import app from '../src/worker/index';
import { addLogin, Client, OWNER, sectionId, setupSchool, signIn } from './helpers';

describe('password hashing', () => {
  it('verifies the right password only', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash).toMatch(/^pbkdf2-sha256\$\d+\$/);
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong horse', hash)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(needsRehash(await hashPassword('a', 1000))).toBe(true);
    expect(needsRehash(hash)).toBe(false);
  });
});

describe('sign in only, no sign up', () => {
  it('has no way to create a login without signing in', async () => {
    const anon = new Client();
    expect([401, 404]).toContain(
      (await anon.post('/setup', { username: 'x', password: 'x' })).status,
    );
    expect((await anon.post('/users', { username: 'x', name: 'x', role: 'admin' })).status).toBe(
      401,
    );
    expect((await anon.get('/students?session_id=1')).status).toBe(401);
  });

  it('lists the open schools on the sign-in screen', async () => {
    await setupSchool();
    const boot = (await new Client().get('/bootstrap')).data;
    expect(boot.needs_setup).toBe(false);
    expect(boot.user).toBeNull();
    expect(boot.login_branches).toEqual([{ id: 1, name: 'Kamalganj' }]);
  });

  it('never stores the session token itself', async () => {
    const owner = await signIn(OWNER.username, OWNER.password);
    const token = owner.cookie.replace('sid=', '');
    const rows = await env.DB.prepare('SELECT token_hash FROM auth_sessions').all<{
      token_hash: string;
    }>();
    expect(rows.results.length).toBeGreaterThan(0);
    expect(rows.results.some((r) => r.token_hash === token)).toBe(false);
  });

  it('rejects wrong passwords and limits repeated failures', async () => {
    const anon = new Client();
    const attempt = (password: string) =>
      anon.post('/auth/login', { username: OWNER.username, password, branch_id: null });
    for (let i = 0; i < 5; i++) expect((await attempt('nope')).status).toBe(401);
    const locked = await attempt(OWNER.password);
    expect(locked.status).toBe(429);
    expect(locked.data.error).toMatch(/Too many wrong attempts/);
    await env.DB.prepare('DELETE FROM login_attempts').run();
    expect((await attempt(OWNER.password)).status).toBe(200);
  });

  it('signs out everywhere else when the password changes', async () => {
    const phone = await signIn(OWNER.username, OWNER.password);
    const laptop = await signIn(OWNER.username, OWNER.password);
    expect(
      (
        await phone.post('/auth/password', {
          current_password: 'bad',
          new_password: 'new-pass-123',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await phone.post('/auth/password', {
          current_password: OWNER.password,
          new_password: OWNER.password,
        })
      ).data.error,
    ).toMatch(/different from the old one/);
    expect(
      (
        await phone.post('/auth/password', {
          current_password: OWNER.password,
          new_password: 'new-pass-123',
        })
      ).status,
    ).toBe(200);
    expect((await laptop.get('/home')).status).toBe(401);
    expect((await phone.get('/home')).status).toBe(200);
    // put it back for other tests
    await phone.post('/auth/password', {
      current_password: 'new-pass-123',
      new_password: OWNER.password,
    });
  });

  it('signs out and clears the cookie', async () => {
    const c = await signIn(OWNER.username, OWNER.password);
    const res = await app.request(
      'http://localhost/api/auth/logout',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: c.cookie },
        body: '{}',
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/^sid=;.*Max-Age=0/);
    expect((await c.get('/home')).status).toBe(401);
  });

  it('answers a blocked cross-site post with 403, not a server error', async () => {
    const res = await app.request(
      'http://localhost/api/auth/logout',
      { method: 'POST', headers: { 'content-type': 'text/plain', origin: 'https://evil.example' } },
      env,
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/blocked/);
  });
});

describe('roles, logins and the school chosen at sign-in', () => {
  let owner: Client;
  let kannauj: number;

  beforeAll(async () => {
    owner = await signIn(OWNER.username, OWNER.password);
    expect((await owner.post('/branches', { name: 'Kannauj', code: 'KNJ' })).status).toBe(200);
    kannauj = (await owner.get('/bootstrap')).data.my_branches.find(
      (b: any) => b.code === 'KNJ',
    ).id;
    await addLogin(owner, {
      username: 'manager',
      name: 'Manager',
      role: 'management',
      password: 'manager-1',
    });
    await addLogin(owner, {
      username: 'acct@sps.com',
      name: 'Kamalganj Accountant',
      role: 'accountant',
      branch_ids: [1],
      password: 'accountant-1',
    });
    // one student in each school
    for (const [branch, name] of [
      [1, 'Kamalganj Kid'],
      [kannauj, 'Kannauj Kid'],
    ] as const) {
      const res = await owner.post('/students', {
        name,
        session_id: 1,
        enrolment: { branch_id: branch, class_id: 4, section_id: await sectionId(branch, 4) },
      });
      expect(res.status).toBe(200);
    }
  });

  const names = async (c: Client) =>
    (await c.get('/students?session_id=1')).data.rows.map((r: any) => r.name).sort();

  it('accepts an email as the username', async () => {
    const acct = await signIn('ACCT@sps.com', 'accountant-1', 1);
    expect((await acct.get('/bootstrap')).data.user.username).toBe('acct@sps.com');
  });

  it('shows only the chosen school', async () => {
    const all = await signIn(OWNER.username, OWNER.password, null);
    expect(await names(all)).toEqual(['Kamalganj Kid', 'Kannauj Kid']);
    const k = await signIn(OWNER.username, OWNER.password, kannauj);
    expect(await names(k)).toEqual(['Kannauj Kid']);
    const boot = (await k.get('/bootstrap')).data;
    expect(boot.user.branch_id).toBe(kannauj);
    expect(boot.branches.map((b: any) => b.code)).toEqual(['KNJ']);
    expect(boot.my_branches.map((b: any) => b.code)).toEqual(['KMG', 'KNJ']);
    expect(boot.sections.every((s: any) => s.branch_id === kannauj)).toBe(true);
    // data of the other school cannot be reached directly either
    const kid = (await all.get('/students?session_id=1&q=Kamalganj')).data.rows[0];
    expect((await k.get(`/students/${kid.student_id}`)).status).toBe(403);
  });

  it('lets admin and management switch school without signing in again', async () => {
    const m = await signIn('manager', 'manager-1', 1);
    expect(await names(m)).toEqual(['Kamalganj Kid']);
    expect((await m.post('/auth/school', { branch_id: kannauj })).status).toBe(200);
    expect(await names(m)).toEqual(['Kannauj Kid']);
    expect((await m.post('/auth/school', { branch_id: null })).status).toBe(200);
    expect(await names(m)).toEqual(['Kamalganj Kid', 'Kannauj Kid']);
  });

  it('keeps an accountant to the schools assigned to them', async () => {
    const tryLogin = (branch: number | null) =>
      new Client().post('/auth/login', {
        username: 'acct@sps.com',
        password: 'accountant-1',
        branch_id: branch,
      });
    expect((await tryLogin(null)).data.error).toMatch(/Choose your school/);
    const wrong = await tryLogin(kannauj);
    expect(wrong.status).toBe(403);
    expect(wrong.data.error).toMatch(/not assigned to this school/);
    expect((await tryLogin(999)).status).toBe(404);
    const acct = await signIn('acct@sps.com', 'accountant-1', 1);
    expect(await names(acct)).toEqual(['Kamalganj Kid']);
    expect((await acct.post('/auth/school', { branch_id: kannauj })).status).toBe(403);
    expect((await acct.post('/auth/school', { branch_id: null })).status).toBe(403);
  });

  it('ends an accountant’s session when they are moved off that school', async () => {
    const acct = await signIn('acct@sps.com', 'accountant-1', 1);
    const row = (await owner.get('/users')).data.find((u: any) => u.username === 'acct@sps.com');
    const edit = (branch_ids: number[]) =>
      owner.put(`/users/${row.id}`, {
        username: 'acct@sps.com',
        name: 'Kamalganj Accountant',
        role: 'accountant',
        branch_ids,
      });
    expect((await edit([kannauj])).status).toBe(200);
    expect((await acct.get('/home')).status).toBe(401);
    await edit([1]);
  });

  it('gives each role its own powers', async () => {
    const m = await signIn('manager', 'manager-1', null);
    const acct = await signIn('acct@sps.com', 'accountant-1', 1);
    // management: daily work in every school
    const added = await m.post('/students', {
      name: 'Added By Manager',
      session_id: 1,
      enrolment: { branch_id: kannauj, class_id: 5, section_id: await sectionId(kannauj, 5) },
    });
    expect(added.status).toBe(200);
    expect((await m.get('/staff')).status).toBe(200);
    // ...but not logins, settings, branches, sessions, activity log or backup
    for (const [method, path] of [
      ['get', '/users'],
      ['put', '/settings'],
      ['post', '/branches'],
      ['post', '/sessions'],
      ['get', '/audit'],
      ['get', '/backup'],
    ] as const) {
      const res = method === 'get' ? await m.get(path) : await m[method](path, {});
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    // accountant: can look students up for fees, nothing more
    expect((await acct.get('/students?session_id=1')).status).toBe(200);
    expect((await acct.post('/students', { name: 'X', session_id: 1, enrolment: {} })).status).toBe(
      403,
    );
    expect((await acct.get('/staff')).status).toBe(403);
    expect((await acct.get('/users')).status).toBe(403);
  });

  it('only accepts the three roles, and gives schools to accountants only', async () => {
    const bad = await owner.post('/users', {
      username: 'teacher1',
      name: 'T',
      role: 'teacher',
      password: 'teacher-11',
    });
    expect(bad.status).toBe(400);
    const noSchool = await owner.post('/users', {
      username: 'acct2',
      name: 'A',
      role: 'accountant',
      branch_ids: [],
      password: 'accountant-2',
    });
    expect(noSchool.data.error).toMatch(/Tick at least one school/);
    await owner.post('/users', {
      username: 'manager2',
      name: 'M2',
      role: 'management',
      branch_ids: [1],
      password: 'manager-22',
    });
    const users = (await owner.get('/users')).data;
    expect(users.find((u: any) => u.username === 'manager2').branch_ids).toEqual([]);
  });

  it('makes a new person choose their own password before anything else', async () => {
    await owner.post('/users', {
      username: 'new@sps.com',
      name: 'New Person',
      role: 'accountant',
      branch_ids: [1],
      password: 'first-pass-1',
    });
    const person = await signIn('new@sps.com', 'first-pass-1', 1);
    const boot = (await person.get('/bootstrap')).data;
    expect(boot.user.must_change_password).toBe(true);
    expect((await person.get('/students?session_id=1')).status).toBe(403);
    expect(
      (
        await person.post('/auth/password', {
          current_password: 'first-pass-1',
          new_password: 'my-own-pass',
        })
      ).status,
    ).toBe(200);
    expect((await person.get('/bootstrap')).data.user.must_change_password).toBe(false);
    expect((await person.get('/students?session_id=1')).status).toBe(200);
    expect((await person.get('/bootstrap')).data.user.branch_id).toBe(1); // still in the same school
  });

  it('signs a person out and asks for a new password when the admin resets it', async () => {
    const acct = await signIn('acct@sps.com', 'accountant-1', 1);
    const row = (await owner.get('/users')).data.find((u: any) => u.username === 'acct@sps.com');
    await owner.put(`/users/${row.id}`, {
      username: 'acct@sps.com',
      name: 'Kamalganj Accountant',
      role: 'accountant',
      branch_ids: [1],
      password: 'reset-pass-1',
    });
    expect((await acct.get('/home')).status).toBe(401);
    const again = await signIn('acct@sps.com', 'reset-pass-1', 1);
    expect((await again.get('/bootstrap')).data.user.must_change_password).toBe(true);
    // switching a login off signs them out and stops them signing in
    await owner.put(`/users/${row.id}`, {
      username: 'acct@sps.com',
      name: 'Kamalganj Accountant',
      role: 'accountant',
      branch_ids: [1],
      active: false,
    });
    expect((await again.get('/bootstrap')).data.user).toBeNull();
    expect(
      (
        await new Client().post('/auth/login', {
          username: 'acct@sps.com',
          password: 'reset-pass-1',
          branch_id: 1,
        })
      ).status,
    ).toBe(403);
  });

  it('lets the admin reset their own password without being locked out', async () => {
    const other = await signIn(OWNER.username, OWNER.password);
    const me = (await owner.get('/bootstrap')).data.user;
    const res = await owner.put(`/users/${me.id}`, {
      username: OWNER.username,
      name: 'Owner',
      role: 'admin',
      password: OWNER.password,
    });
    expect(res.status).toBe(200);
    expect((await other.get('/home')).status).toBe(401);
    expect((await owner.get('/home')).status).toBe(200);
    expect((await owner.get('/bootstrap')).data.user.must_change_password).toBe(false);
    const off = await owner.put(`/users/${me.id}`, {
      username: OWNER.username,
      name: 'Owner',
      role: 'admin',
      active: false,
    });
    expect(off.status).toBe(400);
    const demote = await owner.put(`/users/${me.id}`, {
      username: OWNER.username,
      name: 'Owner',
      role: 'management',
    });
    expect(demote.status).toBe(400);
  });

  it('refuses a closed school at sign-in', async () => {
    await owner.put(`/branches/${kannauj}`, { name: 'Kannauj', code: 'KNJ', active: false });
    const res = await new Client().post('/auth/login', {
      username: OWNER.username,
      password: OWNER.password,
      branch_id: kannauj,
    });
    expect(res.data.error).toMatch(/closed/);
    expect((await new Client().get('/bootstrap')).data.login_branches).toEqual([
      { id: 1, name: 'Kamalganj' },
    ]);
    await owner.put(`/branches/${kannauj}`, { name: 'Kannauj', code: 'KNJ', active: true });
  });

  it('records changes in the activity log', async () => {
    const log = (await owner.get('/audit')).data;
    expect(log.total).toBeGreaterThan(5);
    expect(
      log.rows.some(
        (r: any) =>
          r.entity === 'user' && r.action === 'create' && r.summary.includes('Management'),
      ),
    ).toBe(true);
  });
});
