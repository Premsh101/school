import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, todayIST } from '../src/shared/dates';
import { Client, sectionId, setupSchool } from './helpers';

let owner: Client;
const today = todayIST();
const yesterday = addDays(today, -1);

async function add(name: string, classId: number, roll: number) {
  const res = await owner.post('/students', {
    name,
    phone: '9876500000',
    session_id: 1,
    enrolment: {
      branch_id: 1,
      class_id: classId,
      section_id: await sectionId(1, classId),
      roll_no: roll,
    },
  });
  expect(res.status, JSON.stringify(res.data)).toBe(200);
  return (await owner.get(`/students/${res.data.id}`)).data.enrolments[0].id as number;
}
const report = async (path: string) => {
  const res = await owner.get(path);
  expect(res.status, JSON.stringify(res.data)).toBe(200);
  return res.data as { title: string; columns: { key: string; label: string }[]; rows: any[] };
};
const fees = async (e: number) => (await owner.get(`/fees/students/${e}`)).data;

let paid: number;
let unpaid: number;
let left: number;

beforeAll(async () => {
  owner = await setupSchool();
  paid = await add('Paid Up', 4, 1);
  unpaid = await add('Owes Money', 4, 2);
  await add('Other Class', 5, 1);
  left = await add('Gone Away', 4, 3);
  const f = await fees(paid);
  expect(
    (
      await owner.post('/fees/receipts', {
        enrolment_id: paid,
        date: today,
        settle_amount: f.position.pending,
        mode: 'cash',
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await owner.post('/fees/receipts', {
        enrolment_id: unpaid,
        date: today,
        settle_amount: 500,
        mode: 'upi',
        reference: 'U1',
      })
    ).status,
  ).toBe(200);
  await env.DB.prepare("UPDATE enrolments SET created_at = '2026-03-01T00:00:00.000Z' WHERE id = ?")
    .bind(unpaid)
    .run();
  await owner.post(`/enrolments/${left}/cancel-registration`, { reason: 'Moved away' });
});

describe('class-wise pending list', () => {
  it('lists every student of the class, paid up or not, with phone, late fee and the class order', async () => {
    const r = await report('/fees/reports/classpending?session_id=1&class_id=4');
    expect(r.columns.map((c) => c.key)).toEqual([
      'class',
      'roll_no',
      'name',
      'father_name',
      'phone',
      'phone2',
      'net',
      'paid',
      'overdue',
      'pending',
      'late_fee',
    ]);
    // Studying students of Class 1 only: the one who left and the other class are not listed.
    expect(r.rows.map((x) => [x.class, x.roll_no, x.name])).toEqual([
      ['Class 1 A', 1, 'Paid Up'],
      ['Class 1 A', 2, 'Owes Money'],
    ]);
    expect(r.rows[0]).toMatchObject({ pending: 0, overdue: 0, late_fee: 0, phone: '9876500000' });
    const d = await fees(unpaid);
    expect(r.rows[1]).toMatchObject({
      paid: 500,
      pending: d.position.pending,
      overdue: d.position.overdue,
      late_fee: d.late_fee.outstanding,
    });
    expect(d.late_fee.outstanding).toBeGreaterThan(0);
  });

  it('lists all classes in order when none is chosen', async () => {
    const r = await report('/fees/reports/classpending?session_id=1');
    expect(r.rows.map((x) => x.class)).toEqual(['Class 1 A', 'Class 1 A', 'Class 2 A']);
  });

  it('shows what each student paid in a chosen period', async () => {
    const r = await report(
      `/fees/reports/classpending?session_id=1&class_id=4&from=${today}&to=${today}`,
    );
    expect(r.columns.map((c) => c.key)).toContain('collected');
    expect(r.rows.map((x) => x.collected)).toEqual([(await fees(paid)).position.paid, 500]);
    expect(r.title).toContain(`${today} to ${today}`);
    const none = await report(
      `/fees/reports/classpending?session_id=1&class_id=4&from=${yesterday}&to=${yesterday}`,
    );
    expect(none.rows.map((x) => x.collected)).toEqual([0, 0]);
  });
});

describe('a period on every report', () => {
  it('adds "Collected in period" to pending dues, the fee register and the class and school summaries', async () => {
    for (const name of ['pending', 'register', 'classwise', 'branchwise']) {
      const plain = await report(`/fees/reports/${name}?session_id=1`);
      expect(
        plain.columns.map((c) => c.key),
        name,
      ).not.toContain('collected');
      const dated = await report(`/fees/reports/${name}?session_id=1&from=${today}&to=${today}`);
      expect(
        dated.columns.map((c) => c.key),
        name,
      ).toContain('collected');
      const total = dated.rows.reduce((sum, row) => sum + (row.collected ?? 0), 0);
      // Pending dues lists only students who owe, so the student who paid in full is not in it.
      expect(total, name).toBe(name === 'pending' ? 500 : 500 + (await fees(paid)).position.paid);
    }
  });

  it('limits the discounts report to the period', async () => {
    await owner.post('/fees/receipts', {
      enrolment_id: unpaid,
      date: today,
      settle_amount: 400,
      mode: 'cash',
      counter_discount_type: 'amount',
      counter_discount_value: 100,
    });
    const all = await report('/fees/reports/discounts?session_id=1');
    expect(all.rows.some((x) => x.fee_type === 'Counter discount')).toBe(true);
    const today_ = await report(`/fees/reports/discounts?session_id=1&from=${today}&to=${today}`);
    expect(today_.rows.some((x) => x.fee_type === 'Counter discount')).toBe(true);
    const earlier = await report(
      `/fees/reports/discounts?session_id=1&from=2026-04-01&to=${yesterday}`,
    );
    expect(earlier.rows).toHaveLength(0);
  });

  it('filters the student reports by the day students joined or left', async () => {
    const joinedToday = await report(`/reports/students?session_id=1&from=${today}&to=${today}`);
    // Two of the three studying students joined today; "Owes Money" was backdated.
    expect(joinedToday.rows.map((x) => x.name).sort()).toEqual(['Other Class', 'Paid Up']);
    expect(
      (await report(`/reports/students?session_id=1&from=${yesterday}&to=${yesterday}`)).rows,
    ).toHaveLength(0);
    expect((await report('/reports/students?session_id=1')).rows).toHaveLength(3);
    const strength = await report(`/reports/strength?session_id=1&from=${today}&to=${today}`);
    expect(strength.columns.map((c) => c.key)).toContain('joined');
    expect(strength.rows.reduce((sum, x) => sum + x.joined, 0)).toBe(3); // Gone Away joined today too
    const leftToday = await report(`/reports/left?session_id=1&from=${today}&to=${today}`);
    expect(leftToday.rows.map((x) => [x.name, x.reason])).toEqual([['Gone Away', 'Moved away']]);
    expect(
      (await report(`/reports/left?session_id=1&from=${yesterday}&to=${yesterday}`)).rows,
    ).toHaveLength(0);
  });

  it('keeps today as the end when only a start date is given, and refuses a reversed range', async () => {
    const r = await report(`/fees/reports/pending?session_id=1&from=${yesterday}`);
    expect(r.columns.map((c) => c.key)).toContain('collected');
    expect(
      (await owner.get(`/fees/reports/pending?session_id=1&from=${today}&to=${yesterday}`)).status,
    ).toBe(400);
  });

  it('puts the late fee in the collection register', async () => {
    const r = await report(`/fees/reports/collection?session_id=1&from=${today}&to=${today}`);
    expect(r.columns.map((c) => c.key)).toContain('late_fee');
  });
});
