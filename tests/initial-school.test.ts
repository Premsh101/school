import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RATE_CHART } from '../src/shared/fees';
import { verifyPassword } from '../src/worker/core/password';
import { Client, sectionId, signIn } from './helpers';

const ADMIN = { username: 'admin@sps.com', password: 'admin@123' };
const NEW_PASSWORD = 'owner-own-pass-1';
const count = async (table: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

beforeAll(async () => {
  // Same as the first deploy: all migrations, including the initial school.
  await applyD1Migrations(env.DB, env.TEST_SEED);
});

describe('the school that comes with the first release', () => {
  it('loads the school, both schools, the 2026-27 session and section A everywhere', async () => {
    const settings = await env.DB.prepare(
      "SELECT key, value FROM settings WHERE key LIKE 'school_%'",
    ).all<{ key: string; value: string }>();
    expect(Object.fromEntries(settings.results.map((r) => [r.key, r.value]))).toEqual({
      school_name: 'Soni Pariya Public School',
      school_address: 'Kamalganj, Farrukhabad, Uttar Pradesh',
    });
    const branches = await env.DB.prepare(
      'SELECT id, name, code, active FROM branches ORDER BY id',
    ).all();
    expect(branches.results).toEqual([
      { id: 1, name: 'Kamalganj', code: 'KMG', active: 1 },
      { id: 2, name: 'Kannauj', code: 'KNJ', active: 1 },
      { id: 3, name: 'Demo School', code: 'DEMO', active: 1 },
    ]);
    const sessions = await env.DB.prepare(
      'SELECT name, start_year, start_month, is_current FROM academic_sessions',
    ).all();
    expect(sessions.results).toEqual([
      { name: '2026-27', start_year: 2026, start_month: 4, is_current: 1 },
    ]);
    expect(await count('sections')).toBe(45); // 15 classes in each of the three schools
  });

  it('loads the admin and management logins, with only a hash of their passwords', async () => {
    const users = await env.DB.prepare(
      'SELECT username, name, role, active, must_change_password, password_hash FROM users ORDER BY id',
    ).all<{
      username: string;
      role: string;
      must_change_password: number;
      password_hash: string;
    }>();
    expect(users.results).toHaveLength(2);
    const [admin, manager] = users.results as [
      (typeof users.results)[0],
      (typeof users.results)[0],
    ];
    expect(admin).toMatchObject({
      username: 'admin@sps.com',
      role: 'admin',
      must_change_password: 1,
    });
    expect(admin.password_hash).not.toContain('admin@123');
    expect(await verifyPassword('admin@123', admin.password_hash)).toBe(true);
    expect(manager).toMatchObject({
      username: 'manager@sps.com',
      role: 'management',
      must_change_password: 1,
    });
    expect(manager.password_hash).not.toContain('manager@123');
    expect(await verifyPassword('manager@123', manager.password_hash)).toBe(true);
  });

  it('loads exactly the printed fee chart for both schools', async () => {
    expect(await count('fee_rates')).toBe(90); // the Demo School has a copy of Kamalganj's
    for (const branch of [1, 2, 3]) {
      for (const group of DEFAULT_RATE_CHART) {
        for (const type of ['new', 'old'] as const) {
          for (let order = group.from_order; order <= group.to_order; order++) {
            const row = await env.DB.prepare(
              `SELECT registration, admission, board, annual, practical, practical_alt, tbdb, monthly
                 FROM fee_rates r JOIN classes c ON c.id = r.class_id
                WHERE r.branch_id = ? AND c.sort_order = ? AND r.admission_type = ?`,
            )
              .bind(branch, order, type)
              .first();
            expect(row, `branch ${branch}, class order ${order}, ${type}`).toEqual(group[type]);
          }
        }
      }
    }
  });

  it('is safe to run twice: nothing is added or overwritten', async () => {
    const before = [
      await count('fee_rates'),
      await count('branches'),
      await count('sections'),
      await count('users'),
    ];
    for (const m of env.TEST_SEED) for (const query of m.queries) await env.DB.prepare(query).run();
    expect([
      await count('fee_rates'),
      await count('branches'),
      await count('sections'),
      await count('users'),
    ]).toEqual(before);
  });
});

describe('first sign-in', () => {
  let admin: Client;

  it('shows the sign-in screen with both schools; there is no sign-up', async () => {
    const boot = (await new Client().get('/bootstrap')).data;
    expect(boot.needs_setup).toBe(false);
    expect(boot.user).toBeNull();
    expect(boot.school.name).toBe('Soni Pariya Public School');
    expect(boot.login_branches).toEqual([
      { id: 1, name: 'Kamalganj' },
      { id: 2, name: 'Kannauj' },
      { id: 3, name: 'Demo School' },
    ]);
    expect([401, 404]).toContain((await new Client().post('/setup', {})).status);
  });

  it('signs the admin in with admin@sps.com / admin@123 and asks for a new password first', async () => {
    admin = await signIn(ADMIN.username, ADMIN.password, null);
    const boot = (await admin.get('/bootstrap')).data;
    expect(boot.user).toMatchObject({
      username: 'admin@sps.com',
      role: 'admin',
      must_change_password: true,
      all_schools: true,
      branch_id: null,
    });
    expect((await admin.get('/students?session_id=1')).status).toBe(403);
    expect((await admin.get('/users')).status).toBe(403);
    const res = await admin.post('/auth/password', {
      current_password: ADMIN.password,
      new_password: NEW_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect((await admin.get('/bootstrap')).data.user.must_change_password).toBe(false);
  });

  it('stops accepting admin@123 once the admin has chosen a new password', async () => {
    const old = await new Client().post('/auth/login', { ...ADMIN, branch_id: null });
    expect(old.status).toBe(401);
    expect((await signIn(ADMIN.username, NEW_PASSWORD, 2)).cookie).toMatch(/^sid=/);
  });

  it('comes with the management login manager@sps.com / manager@123, which must set its own password', async () => {
    expect(
      (await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())!.n,
    ).toBe(2);
    const manager = await signIn('manager@sps.com', 'manager@123', null);
    const boot = (await manager.get('/bootstrap')).data;
    expect(boot.user).toMatchObject({
      role: 'management',
      must_change_password: true,
      all_schools: true,
    });
    expect((await manager.get('/students?session_id=1')).status).toBe(403);
    const res = await manager.post('/auth/password', {
      current_password: 'manager@123',
      new_password: 'manager-own-pass-1',
    });
    expect(res.status).toBe(200);
    expect((await manager.get('/students?session_id=1')).status).toBe(200);
    expect((await manager.get('/users')).status).toBe(403);
    const old = await new Client().post('/auth/login', {
      username: 'manager@sps.com',
      password: 'manager@123',
      branch_id: null,
    });
    expect(old.status).toBe(401);
  });

  it('lets the admin create the other logins', async () => {
    const res = await admin.post('/users', {
      username: 'kannauj@sps.com',
      name: 'Kannauj Accountant',
      role: 'accountant',
      branch_ids: [2],
      password: 'first-pass-1',
    });
    expect(res.status).toBe(200);
    expect(
      (
        await new Client().post('/auth/login', {
          username: 'kannauj@sps.com',
          password: 'first-pass-1',
          branch_id: 1,
        })
      ).status,
    ).toBe(403);
    const acct = await signIn('kannauj@sps.com', 'first-pass-1', 2);
    expect((await acct.get('/bootstrap')).data.user.must_change_password).toBe(true);
  });

  it('gives the fee chart to students straight away, per school', async () => {
    const add = async (branch: number, name: string) => {
      const res = await admin.post('/students', {
        name,
        session_id: 1,
        enrolment: {
          branch_id: branch,
          class_id: 8,
          section_id: await sectionId(branch, 8),
          admission_type: 'new',
        },
      });
      expect(res.status, JSON.stringify(res.data)).toBe(200);
      const detail = (await admin.get(`/students/${res.data.id}`)).data;
      return (await admin.get(`/fees/students/${detail.enrolments[0].id}`)).data;
    };
    const kamalganj = await add(1, 'Kamalganj Kid');
    expect(kamalganj.due_at_admission).toBe(100 + 3000 + 500 + 800); // Class 5 new, as printed
    expect(kamalganj.position.net).toBe(100 + 3000 + 500 + 800 * 12);
    await admin.put('/fees/rates', {
      session_id: 1,
      branch_ids: [2],
      class_ids: [8],
      new: {
        registration: 100,
        admission: 3000,
        board: 0,
        annual: 0,
        practical: 0,
        practical_alt: 0,
        tbdb: 500,
        monthly: 900,
      },
      old: {
        registration: 0,
        admission: 0,
        board: 0,
        annual: 2000,
        practical: 0,
        practical_alt: 0,
        tbdb: 0,
        monthly: 900,
      },
    });
    const kannauj = await add(2, 'Kannauj Kid');
    expect(kannauj.position.net).toBe(100 + 3000 + 500 + 900 * 12);
    expect(
      (await admin.get(`/fees/students/${kamalganj.student.enrolment_id}`)).data.position.net,
    ).toBe(kamalganj.position.net);
  });

  it('numbers receipts per school from the first one', async () => {
    const list = (await admin.get('/fees/collect?session_id=1&q=Kannauj')).data.rows;
    const res = await admin.post('/fees/receipts', {
      enrolment_id: list[0].enrolment_id,
      date: new Date().toISOString().slice(0, 10),
      settle_amount: 1000,
      mode: 'cash',
    });
    expect(res.status).toBe(200);
    const receipt = (await admin.get(`/fees/receipts/${res.data.id}`)).data;
    expect(receipt.receipt.receipt_no).toBe('KNJ-00001');
    expect(receipt.branch.name).toBe('Kannauj');
  });
});
