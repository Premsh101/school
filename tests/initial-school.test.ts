import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RATE_CHART } from '../src/shared/fees';
import { Client, sectionId } from './helpers';

const OWNER = { owner_name: 'Prem', username: 'prem', password: 'school-pass-1' };
const count = async (table: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

beforeAll(async () => {
  // Same as the first deploy: all migrations, including the initial school.
  await applyD1Migrations(env.DB, env.TEST_SEED);
});

describe('the school that comes with the first release', () => {
  it('loads the school, both branches, the 2026-27 session and section A everywhere', async () => {
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
    ]);
    const sessions = await env.DB.prepare(
      'SELECT name, start_year, start_month, is_current FROM academic_sessions',
    ).all();
    expect(sessions.results).toEqual([
      { name: '2026-27', start_year: 2026, start_month: 4, is_current: 1 },
    ]);
    expect(await count('sections')).toBe(30);
    expect(await count('users')).toBe(0); // no password is ever loaded with the app
  });

  it('loads exactly the printed fee chart for both branches', async () => {
    expect(await count('fee_rates')).toBe(60);
    for (const branch of [1, 2]) {
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
    await env.DB.prepare(
      "UPDATE fee_rates SET monthly = 999 WHERE branch_id = 2 AND class_id = 4 AND admission_type = 'new'",
    ).run();
    for (const query of env.TEST_SEED[0]!.queries) await env.DB.prepare(query).run();
    expect(await count('fee_rates')).toBe(60);
    expect(await count('branches')).toBe(2);
    expect(await count('sections')).toBe(30);
    const edited = await env.DB.prepare(
      "SELECT monthly FROM fee_rates WHERE branch_id = 2 AND class_id = 4 AND admission_type = 'new'",
    ).first<{ monthly: number }>();
    expect(edited!.monthly).toBe(999);
    await env.DB.prepare(
      "UPDATE fee_rates SET monthly = 800 WHERE branch_id = 2 AND class_id = 4 AND admission_type = 'new'",
    ).run();
  });
});

describe('first visit', () => {
  let owner: Client;

  it('asks only for the owner login and shows what is ready', async () => {
    const boot = (await new Client().get('/bootstrap')).data;
    expect(boot.needs_setup).toBe(true);
    expect(boot.school.name).toBe('Soni Pariya Public School');
    expect(boot.preset).toEqual({ branches: ['Kamalganj', 'Kannauj'], session: '2026-27' });
    const bad = await new Client().post('/setup', {
      owner_name: 'P',
      username: 'p',
      password: 'short',
    });
    expect(bad.status).toBe(400);
  });

  it('creates the owner, signs in, and the school is ready to use', async () => {
    owner = new Client();
    expect((await owner.post('/setup', OWNER)).status).toBe(200);
    const boot = (await owner.get('/bootstrap')).data;
    expect(boot.user).toMatchObject({ username: 'prem', name: 'Prem', role: 'admin' });
    expect(boot.branches.map((b: any) => b.code)).toEqual(['KMG', 'KNJ']);
    expect(boot.sessions.map((s: any) => [s.name, s.is_current])).toEqual([['2026-27', 1]]);
    expect(boot.sections).toHaveLength(30);
    expect(boot.modules).toEqual({ fees: true });
    const log = (await owner.get('/audit')).data.rows.map((r: any) => r.summary);
    expect(log).toContain('Owner login created');
  });

  it('closes the setup screen afterwards', async () => {
    expect((await new Client().post('/setup', OWNER)).status).toBe(403);
    const boot = (await new Client().get('/bootstrap')).data;
    expect(boot.needs_setup).toBe(false);
    expect(boot.preset).toBeNull();
  });

  it('gives the fee chart to students straight away, per branch', async () => {
    const add = async (branch: number, name: string) => {
      const res = await owner.post('/students', {
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
      const detail = (await owner.get(`/students/${res.data.id}`)).data;
      return (await owner.get(`/fees/students/${detail.enrolments[0].id}`)).data;
    };
    const kamalganj = await add(1, 'Kamalganj Kid');
    expect(kamalganj.due_at_admission).toBe(100 + 3000 + 500 + 800); // Class 5 new, as printed: 4,400
    expect(kamalganj.position.net).toBe(100 + 3000 + 500 + 800 * 12);
    await owner.put('/fees/rates', {
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
      (await owner.get(`/fees/students/${kamalganj.student.enrolment_id}`)).data.position.net,
    ).toBe(kamalganj.position.net);
  });

  it('numbers receipts per branch from the first one', async () => {
    const list = (await owner.get('/fees/collect?session_id=1&q=Kannauj')).data.rows;
    const res = await owner.post('/fees/receipts', {
      enrolment_id: list[0].enrolment_id,
      date: new Date().toISOString().slice(0, 10),
      settle_amount: 1000,
      mode: 'cash',
    });
    expect(res.status).toBe(200);
    const receipt = (await owner.get(`/fees/receipts/${res.data.id}`)).data;
    expect(receipt.receipt.receipt_no).toBe('KNJ-00001');
    expect(receipt.branch.name).toBe('Kannauj');
  });

  it('does nothing if the initial school is loaded again once a login exists', async () => {
    const before = [await count('branches'), await count('fee_rates'), await count('sections')];
    for (const query of env.TEST_SEED[0]!.queries) await env.DB.prepare(query).run();
    expect([await count('branches'), await count('fee_rates'), await count('sections')]).toEqual(
      before,
    );
  });
});
