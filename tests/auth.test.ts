import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, verifyPassword } from '../src/worker/core/password';
import { Client, OWNER, setupSchool, signIn } from './helpers';

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

describe('setup and sign-in', () => {
  let owner: Client;

  it('asks for setup on an empty database and blocks everything else', async () => {
    const anon = new Client();
    expect((await anon.get('/bootstrap')).data.needs_setup).toBe(true);
    expect((await anon.get('/students?session_id=1')).status).toBe(401);
  });

  it('creates the owner, branch, sections and session, then closes', async () => {
    owner = await setupSchool();
    const boot = (await owner.get('/bootstrap')).data;
    expect(boot.needs_setup).toBe(false);
    expect(boot.user).toMatchObject({ username: 'owner', role: 'admin' });
    expect(boot.branches).toHaveLength(1);
    expect(boot.sessions[0]).toMatchObject({ name: '2026-27', is_current: 1, start_month: 4 });
    expect(boot.classes).toHaveLength(15);
    expect(boot.sections).toHaveLength(15);
    expect(owner.cookie).toMatch(/^sid=/);

    const again = await new Client().post('/setup', {
      school_name: 'Other',
      owner_name: 'Hacker',
      username: 'hacker',
      password: 'hacker-pass',
      branch: { name: 'X', code: 'XX' },
      session_start_year: 2026,
    });
    expect(again.status).toBe(403);
    expect((await new Client().post('/restore/begin')).status).toBe(403);
  });

  it('never stores the session token itself', async () => {
    const token = owner.cookie.replace('sid=', '');
    const rows = await env.DB.prepare('SELECT token_hash FROM auth_sessions').all<{
      token_hash: string;
    }>();
    expect(rows.results.length).toBeGreaterThan(0);
    expect(rows.results.some((r) => r.token_hash === token)).toBe(false);
  });

  it('rejects wrong passwords and limits repeated failures', async () => {
    const anon = new Client();
    for (let i = 0; i < 5; i++) {
      expect((await anon.post('/auth/login', { username: 'owner', password: 'nope' })).status).toBe(
        401,
      );
    }
    const locked = await anon.post('/auth/login', OWNER);
    expect(locked.status).toBe(429);
    expect(locked.data.error).toMatch(/Too many wrong attempts/);
    await env.DB.prepare('DELETE FROM login_attempts').run();
    expect((await anon.post('/auth/login', OWNER)).status).toBe(200);
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
          new_password: 'new-pass-123',
        })
      ).status,
    ).toBe(200);
    expect((await laptop.get('/home')).status).toBe(401);
    expect((await phone.get('/home')).status).toBe(200);
    expect((await new Client().post('/auth/login', OWNER)).status).toBe(401);
    // put it back for other tests
    await phone.post('/auth/password', {
      current_password: 'new-pass-123',
      new_password: OWNER.password,
    });
  });

  it('signs out', async () => {
    const c = await signIn(OWNER.username, OWNER.password);
    await c.post('/auth/logout');
    expect((await c.get('/home')).status).toBe(401);
  });
});

describe('roles and branch scope', () => {
  let owner: Client;
  let principal: Client;
  let accountant: Client;
  let branch2: number;

  beforeAll(async () => {
    owner = await signIn(OWNER.username, OWNER.password);
    expect((await owner.post('/branches', { name: 'Second', code: 'SEC' })).status).toBe(200);
    branch2 = (await owner.get('/bootstrap')).data.branches.find((b: any) => b.code === 'SEC').id;
    await owner.post('/users', {
      username: 'principal1',
      name: 'P One',
      role: 'principal',
      branch_ids: [1],
      password: 'principal-1',
    });
    await owner.post('/users', {
      username: 'acct2',
      name: 'A Two',
      role: 'accountant',
      branch_ids: [branch2],
      password: 'accountant-2',
    });
    principal = await signIn('principal1', 'principal-1');
    accountant = await signIn('acct2', 'accountant-2');
  });

  it('rejects a duplicate branch code with a helpful message', async () => {
    const res = await owner.post('/branches', { name: 'Again', code: 'sec' });
    expect(res.status).toBe(409);
    expect(res.data.error).toMatch(/already used/);
  });

  it('shows users only their own branches', async () => {
    expect((await principal.get('/bootstrap')).data.branches.map((b: any) => b.id)).toEqual([1]);
    expect((await accountant.get('/bootstrap')).data.branches.map((b: any) => b.id)).toEqual([
      branch2,
    ]);
  });

  it('keeps school settings for the admin', async () => {
    expect((await principal.put('/settings', { school_name: 'Mine' })).status).toBe(403);
    expect((await principal.post('/branches', { name: 'B', code: 'BB' })).status).toBe(403);
    expect((await principal.post('/sessions', { start_year: 2027 })).status).toBe(403);
    expect((await principal.get('/audit')).status).toBe(403);
    expect((await principal.get('/backup')).status).toBe(403);
    expect(
      (await owner.put('/settings', { school_name: 'Soni Pariya Public School' })).status,
    ).toBe(200);
  });

  it('lets a principal manage lower logins in their own branch only', async () => {
    const ok = await principal.post('/users', {
      username: 'teacher1',
      name: 'T',
      role: 'teacher',
      branch_ids: [1],
      password: 'teacher-11',
    });
    expect(ok.status).toBe(200);
    expect(
      (
        await principal.post('/users', {
          username: 'teach2',
          name: 'T',
          role: 'teacher',
          branch_ids: [branch2],
          password: 'teacher-22',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await principal.post('/users', {
          username: 'boss',
          name: 'B',
          role: 'admin',
          branch_ids: [],
          password: 'boss-pass-1',
        })
      ).status,
    ).toBe(403);
    const visible = (await principal.get('/users')).data.map((u: any) => u.username);
    expect(visible).toEqual(['teacher1']);
    expect((await accountant.get('/users')).status).toBe(403);
    const ownerRow = (await owner.get('/users')).data.find((u: any) => u.username === 'owner');
    expect(
      (
        await principal.put(`/users/${ownerRow.id}`, {
          username: 'owner',
          name: 'X',
          role: 'staff',
          branch_ids: [1],
        })
      ).status,
    ).toBe(403);
  });

  it('stops an admin locking themselves out', async () => {
    const me = (await owner.get('/bootstrap')).data.user;
    const res = await owner.put(`/users/${me.id}`, {
      username: 'owner',
      name: 'Owner',
      role: 'admin',
      branch_ids: [],
      active: false,
    });
    expect(res.status).toBe(400);
  });

  it('signs a user out when the admin resets their password or switches them off', async () => {
    const t = await signIn('teacher1', 'teacher-11');
    const row = (await owner.get('/users')).data.find((u: any) => u.username === 'teacher1');
    await owner.put(`/users/${row.id}`, {
      username: 'teacher1',
      name: 'T',
      role: 'teacher',
      branch_ids: [1],
      password: 'teacher-new1',
    });
    expect((await t.get('/home')).status).toBe(401);
    const t2 = await signIn('teacher1', 'teacher-new1');
    await owner.put(`/users/${row.id}`, {
      username: 'teacher1',
      name: 'T',
      role: 'teacher',
      branch_ids: [1],
      active: false,
    });
    expect((await t2.get('/home')).status).toBe(401);
    expect(
      (await new Client().post('/auth/login', { username: 'teacher1', password: 'teacher-new1' }))
        .status,
    ).toBe(403);
  });

  it('enforces branch scope on students and staff', async () => {
    const sec1 = (await owner.get('/bootstrap')).data.sections.find(
      (s: any) => s.branch_id === 1 && s.class_id === 4,
    ).id;
    const created = await owner.post('/students', {
      name: 'Scope Kid',
      session_id: 1,
      enrolment: { branch_id: 1, class_id: 4, section_id: sec1, roll_no: 90 },
    });
    expect(created.status).toBe(200);
    // accountant of branch 2 cannot see or open a branch 1 student
    expect((await accountant.get('/students?session_id=1')).data.total).toBe(0);
    expect((await accountant.get(`/students/${created.data.id}`)).status).toBe(403);
    // and cannot edit students at all
    expect((await accountant.put(`/students/${created.data.id}`, { name: 'X' })).status).toBe(403);
    // principal of branch 1 can see, but cannot add into branch 2
    expect((await principal.get('/students?session_id=1')).data.total).toBe(1);
    const sec2 = (await owner.get('/bootstrap')).data.sections.find(
      (s: any) => s.branch_id === branch2 && s.class_id === 4,
    ).id;
    const denied = await principal.post('/students', {
      name: 'Other',
      session_id: 1,
      enrolment: { branch_id: branch2, class_id: 4, section_id: sec2 },
    });
    expect(denied.status).toBe(403);
    expect((await principal.post('/staff', { name: 'S', branch_id: branch2 })).status).toBe(403);
    expect(
      (await principal.post('/staff', { name: 'S', branch_id: 1, designation: 'Clerk' })).status,
    ).toBe(200);
    expect((await owner.get('/staff')).data).toHaveLength(1);
    expect((await accountant.get('/staff')).status).toBe(403);
    expect(
      (await principal.post('/sections', { branch_id: branch2, class_id: 4, name: 'B' })).status,
    ).toBe(403);
    expect(
      (await principal.post('/sections', { branch_id: 1, class_id: 4, name: 'B' })).status,
    ).toBe(200);
  });

  it('records changes in the audit log', async () => {
    const log = (await owner.get('/audit')).data;
    expect(log.total).toBeGreaterThan(5);
    expect(
      log.rows.some(
        (r: any) =>
          r.entity === 'student' && r.action === 'create' && r.user_name === 'Owner' && r.entity_id,
      ),
    ).toBe(true);
  });
});
