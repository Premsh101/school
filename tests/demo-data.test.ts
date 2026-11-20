import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, signIn } from './helpers';

let all: Client;
let demo: Client;

beforeAll(async () => {
  // Same as the first deploy: every migration, including the Demo School.
  await applyD1Migrations(env.DB, env.TEST_SEED);
  await env.DB.prepare(
    "UPDATE users SET must_change_password = 0 WHERE username = 'admin@sps.com'",
  ).run();
  all = await signIn('admin@sps.com', 'admin@123', null);
  demo = await signIn('admin@sps.com', 'admin@123', 3);
});

describe('the Demo School that ships with the app', () => {
  it('is a demo school with 45 students, staff and receipts of its own', async () => {
    const branch = await env.DB.prepare("SELECT * FROM branches WHERE code = 'DEMO'").first();
    expect(branch).toMatchObject({ name: 'Demo School', is_demo: 1, active: 1 });
    const list = (await demo.get('/students?session_id=1&status=all')).data;
    expect(list.total).toBe(45);
    const home = (await demo.get('/home?session_id=1')).data;
    expect(home.staff).toEqual([{ branch_id: 3, count: 5 }]);
    const receipts = await env.DB.prepare(
      "SELECT COUNT(*) AS n, MIN(receipt_no) AS first FROM receipts WHERE receipt_no LIKE 'DEMO-%'",
    ).first<{ n: number; first: string }>();
    expect(receipts!.n).toBeGreaterThan(200);
    expect(receipts!.first).toBe('DEMO-00001');
    expect(
      await env.DB.prepare("SELECT 1 FROM settings WHERE key = 'demo.loading'").first(),
    ).toBeNull();
  });

  it('has fee records that agree with its receipts', async () => {
    const rows = await env.DB.prepare(
      `SELECT f.paid, f.counter_discount,
              (SELECT COALESCE(SUM(amount), 0) FROM receipts r WHERE r.enrolment_id = f.enrolment_id AND r.cancelled_at IS NULL) AS received,
              (SELECT COALESCE(SUM(counter_discount), 0) FROM receipts r WHERE r.enrolment_id = f.enrolment_id AND r.cancelled_at IS NULL) AS given
         FROM student_fees f`,
    ).all<{ paid: number; counter_discount: number; received: number; given: number }>();
    expect(rows.results).toHaveLength(45);
    for (const r of rows.results) {
      expect(r.paid).toBe(r.received);
      expect(r.counter_discount).toBe(r.given);
    }
  });

  it('fills the dashboard when chosen, and stays out of All schools', async () => {
    const dash = (await demo.get('/fees/dashboard?session_id=1')).data;
    expect(dash.total.paid).toBeGreaterThan(0);
    const real = (await all.get('/fees/dashboard?session_id=1')).data;
    expect(real.total.paid).toBe(0);
    expect(real.by_branch.map((b: { branch_id: number }) => b.branch_id)).not.toContain(3);
    expect((await all.get('/students?session_id=1')).data.total).toBe(0);
  });

  it('takes the next receipt number after its sample ones', async () => {
    const list = (await demo.get('/fees/collect?session_id=1')).data.rows;
    const owing = list.find((r: { pending: number }) => r.pending > 0);
    const res = await demo.post('/fees/receipts', {
      enrolment_id: owing.enrolment_id,
      date: new Date().toISOString().slice(0, 10),
      settle_amount: 100,
      mode: 'cash',
    });
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    const row = await env.DB.prepare('SELECT receipt_no FROM receipts WHERE id = ?')
      .bind(res.data.id)
      .first<{ receipt_no: string }>();
    expect(row!.receipt_no).toMatch(/^DEMO-00\d{3}$/);
    const prev = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM receipts WHERE branch_id = 3 AND id <> ?',
    )
      .bind(res.data.id)
      .first<{ n: number }>();
    expect(row!.receipt_no).toBe(`DEMO-${String(prev!.n + 1).padStart(5, '0')}`);
  });
});
