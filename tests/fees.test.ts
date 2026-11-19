import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { todayIST } from '../src/shared/dates';
import { monthsStarted } from '../src/shared/fees';
import { Client, sectionId, setupSchool, signIn } from './helpers';

const zero = {
  registration: 0,
  admission: 0,
  board: 0,
  annual: 0,
  practical: 0,
  practical_alt: 0,
  tbdb: 0,
  monthly: 0,
};
let owner: Client;
let branch2: number;
const rate = (rows: any[], classId: number, type: string, branch = 1) =>
  rows.find((r) => r.branch_id === branch && r.class_id === classId && r.admission_type === type);
const today = todayIST();
const started = monthsStarted({ start_year: 2026, start_month: 4 }, today);

async function addStudent(
  name: string,
  classId: number,
  over: Record<string, unknown> = {},
  branch = 1,
): Promise<number> {
  const res = await owner.post('/students', {
    name,
    phone: '9876500000',
    session_id: 1,
    enrolment: {
      branch_id: branch,
      class_id: classId,
      section_id: await sectionId(branch, classId),
      admission_type: 'new',
      ...over,
    },
  });
  expect(res.status, JSON.stringify(res.data)).toBe(200);
  const detail = (await owner.get(`/students/${res.data.id}`)).data;
  return detail.enrolments[0].id;
}
const pay = (
  client: Client,
  enrolment_id: number,
  settle_amount: number,
  over: Record<string, unknown> = {},
) =>
  client.post('/fees/receipts', {
    enrolment_id,
    date: today,
    settle_amount,
    mode: 'cash',
    ...over,
  });
const items = (detail: any, change: Record<string, object> = {}) =>
  detail.plan.items.map((i: any) => ({
    type: i.type,
    amount: i.amount,
    discount_type: i.discount_type,
    discount_value: i.discount_value,
    ...(change[i.type] ?? {}),
  }));

beforeAll(async () => {
  owner = await setupSchool();
});

describe('fee rate chart', () => {
  it('starts the first session with the printed 2026-27 chart', async () => {
    const rows = (await owner.get('/fees/rates?session_id=1')).data;
    expect(rows).toHaveLength(30);
    expect(rate(rows, 1, 'new')).toMatchObject({
      registration: 100,
      admission: 2500,
      tbdb: 500,
      monthly: 700,
      annual: 0,
    });
    expect(rate(rows, 3, 'old')).toMatchObject({ annual: 1800, monthly: 700, admission: 0 });
    expect(rate(rows, 11, 'old')).toMatchObject({ annual: 2200, monthly: 900 });
    expect(rate(rows, 12, 'new')).toMatchObject({
      registration: 200,
      admission: 3500,
      board: 1000,
      practical: 600,
      tbdb: 700,
      monthly: 1200,
    });
    expect(rate(rows, 14, 'new')).toMatchObject({
      admission: 4500,
      practical: 600,
      practical_alt: 900,
      monthly: 1400,
    });
    expect(rate(rows, 15, 'old')).toMatchObject({
      board: 1500,
      annual: 3500,
      practical_alt: 900,
      monthly: 1400,
    });
  });

  it('gives a new branch a copy of the chart, which can then differ', async () => {
    await owner.post('/branches', { name: 'Kannauj', code: 'KNJ' });
    branch2 = (await owner.get('/bootstrap')).data.branches.find((b: any) => b.code === 'KNJ').id;
    expect((await owner.post('/fees/rates/start', { session_id: 1 })).status).toBe(200);
    let rows = (await owner.get('/fees/rates?session_id=1')).data;
    expect(rows).toHaveLength(60);
    const res = await owner.put('/fees/rates', {
      session_id: 1,
      branch_ids: [branch2],
      class_ids: [4, 5],
      new: { ...zero, registration: 150, admission: 3100, tbdb: 500, monthly: 850 },
      old: { ...zero, annual: 2100, monthly: 850 },
    });
    expect(res.status).toBe(200);
    rows = (await owner.get('/fees/rates?session_id=1')).data;
    expect(rows).toHaveLength(60);
    expect(rate(rows, 4, 'new', branch2)).toMatchObject({
      registration: 150,
      admission: 3100,
      monthly: 850,
    });
    expect(rate(rows, 6, 'new', branch2)).toMatchObject({ admission: 3000, monthly: 800 });
    expect(rate(rows, 4, 'new', 1)).toMatchObject({
      registration: 100,
      admission: 3000,
      monthly: 800,
    });
  });

  it('refuses amounts that are not whole rupees, negative, or a lower "higher" practical', async () => {
    const put = (over: object) =>
      owner.put('/fees/rates', {
        session_id: 1,
        branch_ids: [1],
        class_ids: [15],
        new: { ...zero, ...over },
        old: zero,
      });
    expect((await put({ monthly: 10.5 })).status).toBe(400);
    expect((await put({ monthly: -1 })).status).toBe(400);
    expect((await put({ practical: 600, practical_alt: 500 })).data.error).toMatch(
      /higher practical option must be more/,
    );
    expect(
      (
        await owner.put('/fees/rates', {
          session_id: 1,
          branch_ids: [1],
          class_ids: [99],
          new: zero,
          old: zero,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await owner.put('/fees/rates', {
          session_id: 77,
          branch_ids: [1],
          class_ids: [1],
          new: zero,
          old: zero,
        })
      ).status,
    ).toBe(404);
  });
});

describe('student fees', () => {
  let e: number;
  it('copies the fees from the chart at enrolment', async () => {
    e = await addStudent('Nine New', 12, { roll_no: 1 });
    const d = (await owner.get(`/fees/students/${e}`)).data;
    expect(d.plan.months).toBe(12);
    expect(d.plan.items.map((i: any) => [i.type, i.amount])).toEqual([
      ['registration', 200],
      ['admission', 3500],
      ['board', 1000],
      ['annual', 0],
      ['practical', 600],
      ['tbdb', 700],
      ['monthly', 1200],
    ]);
    expect(d.due_at_admission).toBe(7200);
    expect(d.position).toMatchObject({
      fee: 20400,
      discount: 0,
      net: 20400,
      paid: 0,
      pending: 20400,
      due_today: 6000 + 1200 * started,
    });
    expect(d.rate).toMatchObject({ admission: 3500 });
  });

  it('is not changed when the chart is edited later', async () => {
    await owner.put('/fees/rates', {
      session_id: 1,
      branch_ids: [1],
      class_ids: [12],
      new: {
        ...zero,
        registration: 300,
        admission: 4000,
        board: 1000,
        practical: 600,
        tbdb: 700,
        monthly: 1500,
      },
      old: { ...zero, board: 1000, annual: 2500, practical: 600, monthly: 1500 },
    });
    expect((await owner.get(`/fees/students/${e}`)).data.position.net).toBe(20400);
    const later = await addStudent('Nine Later', 12, { roll_no: 2 });
    expect((await owner.get(`/fees/students/${later}`)).data.position.net).toBe(
      300 + 4000 + 1000 + 600 + 700 + 1500 * 12,
    );
  });

  it('saves a discount per fee type, as % or ₹, and recomputes on the server', async () => {
    const d = (await owner.get(`/fees/students/${e}`)).data;
    const res = await owner.put(`/fees/students/${e}`, {
      months: 12,
      discount_reason: 'Sibling',
      items: items(d, {
        admission: { discount_type: 'amount', discount_value: 500 },
        monthly: { discount_type: 'percent', discount_value: 25 },
      }),
    });
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    const after = (await owner.get(`/fees/students/${e}`)).data;
    expect(after.discount_reason).toBe('Sibling');
    expect(after.plan.items.find((i: any) => i.type === 'monthly')).toMatchObject({
      discount: 300,
      discount_type: 'percent',
      discount_value: 25,
    });
    expect(after.position).toMatchObject({
      fee: 20400,
      discount: 500 + 300 * 12,
      net: 5500 + 900 * 12,
    });
    expect(after.due_at_admission).toBe(6400);
  });

  it('refuses impossible discounts and months', async () => {
    const d = (await owner.get(`/fees/students/${e}`)).data;
    const bad = async (change: Record<string, object>, months = 12) =>
      (await owner.put(`/fees/students/${e}`, { months, items: items(d, change) })).status;
    expect(await bad({ monthly: { discount_type: 'percent', discount_value: 101 } })).toBe(400);
    expect(await bad({ admission: { discount_type: 'amount', discount_value: 99999 } })).toBe(400);
    expect(await bad({ admission: { amount: 10.5 } })).toBe(400);
    expect(await bad({}, 13)).toBe(400);
  });

  it('lets Class 11 choose the higher practical, and fewer months', async () => {
    const e11 = await addStudent('Eleven', 14);
    const d = (await owner.get(`/fees/students/${e11}`)).data;
    expect(d.rate.practical_alt).toBe(900);
    await owner.put(`/fees/students/${e11}`, {
      months: 10,
      items: items(d, { practical: { amount: 900 } }),
    });
    const after = (await owner.get(`/fees/students/${e11}`)).data;
    expect(after.position.net).toBe(200 + 4500 + 1000 + 900 + 800 + 1400 * 10);
    expect(after.allocation.months.slice(10).map((m: any) => m.status)).toEqual([
      'waived',
      'waived',
    ]);
  });
});

describe('collecting fees', () => {
  let e: number;
  let firstReceipt: number;
  beforeAll(async () => {
    e = await addStudent('Payer Kumar', 8, { roll_no: 5 }); // Class 5 new: one-time 3600, monthly 800 → 13,200
  });

  it('saves a receipt with a running number and clears the oldest charges first', async () => {
    const res = await pay(owner, e, 4400);
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    firstReceipt = res.data.id;
    const d = (await owner.get(`/fees/students/${e}`)).data;
    expect(d.receipts[0]).toMatchObject({
      receipt_no: 'KMG-00001',
      amount: 4400,
      mode: 'cash',
      collected_by_name: 'Owner',
      covers: 'Registration, Admission, TBDB etc., April',
    });
    expect(d.position).toMatchObject({ paid: 4400, pending: 8800 });
    expect(d.allocation.one_time.every((c: any) => c.balance === 0)).toBe(true);
    expect(d.allocation.months[0].status).toBe('paid');
    const second = await pay(owner, e, 1000, { mode: 'upi', reference: 'UPI123' });
    const d2 = (await owner.get(`/fees/students/${e}`)).data;
    expect(d2.receipts[0]).toMatchObject({ receipt_no: 'KMG-00002', covers: 'May, June (part)' });
    expect(d2.allocation.months.slice(0, 3).map((m: any) => m.status)).toEqual([
      'paid',
      'paid',
      'part',
    ]);
    expect(second.data.id).toBeGreaterThan(firstReceipt);
  });

  it('numbers receipts separately for each branch', async () => {
    const k = await addStudent('Kannauj Kid', 8, {}, branch2);
    await pay(owner, k, 500);
    expect((await owner.get(`/fees/students/${k}`)).data.receipts[0].receipt_no).toBe('KNJ-00001');
  });

  it('refuses more than pending, future dates, and non-cash without a reference', async () => {
    const over = await pay(owner, e, 7801);
    expect(over.status).toBe(400);
    expect(over.data.error).toMatch(/Only ₹7,800 is pending/);
    expect((await pay(owner, e, 100, { date: '2999-01-01' })).data.error).toMatch(
      /cannot be in the future/,
    );
    expect((await pay(owner, e, 100, { mode: 'cheque' })).data.error).toMatch(/reference number/);
    expect((await pay(owner, e, 0)).status).toBe(400);
    expect((await pay(owner, e, 99.5)).status).toBe(400);
  });

  it('records an extra discount given at the counter, in ₹ or %', async () => {
    const res = await pay(owner, e, 1000, {
      counter_discount_type: 'percent',
      counter_discount_value: 10,
      note: 'Paid early',
    });
    expect(res.status).toBe(200);
    const d = (await owner.get(`/fees/students/${e}`)).data;
    expect(d.receipts[0]).toMatchObject({ amount: 900, counter_discount: 100 });
    expect(d.position).toMatchObject({
      paid: 6300,
      counter_discount: 100,
      settled: 6400,
      pending: 6800,
    });
    expect(
      (await pay(owner, e, 500, { counter_discount_type: 'amount', counter_discount_value: 600 }))
        .status,
    ).toBe(400);
  });

  it('will not let the fee be lowered below what is already settled', async () => {
    const d = (await owner.get(`/fees/students/${e}`)).data;
    const res = await owner.put(`/fees/students/${e}`, { months: 1, items: items(d) });
    expect(res.status).toBe(400);
    expect(res.data.error).toMatch(/already paid ₹6,400/);
  });

  it('shows the receipt for printing', async () => {
    const r = (await owner.get(`/fees/receipts/${firstReceipt}`)).data;
    expect(r.receipt).toMatchObject({ receipt_no: 'KMG-00001', amount: 4400 });
    expect(r.student.name).toBe('Payer Kumar');
    expect(r.school.name).toBe('Test School');
    expect(r.branch.name).toBe('Kamalganj');
    expect(r.pending).toBe(6800);
  });

  it('cancels a receipt with a reason; it stays on record and the balance recalculates', async () => {
    expect((await owner.post(`/fees/receipts/${firstReceipt}/cancel`, { reason: '' })).status).toBe(
      400,
    );
    expect(
      (await owner.post(`/fees/receipts/${firstReceipt}/cancel`, { reason: 'Wrong student' }))
        .status,
    ).toBe(200);
    expect(
      (await owner.post(`/fees/receipts/${firstReceipt}/cancel`, { reason: 'Again' })).status,
    ).toBe(409);
    const d = (await owner.get(`/fees/students/${e}`)).data;
    expect(d.receipts).toHaveLength(3);
    expect(d.receipts[2]).toMatchObject({
      receipt_no: 'KMG-00001',
      cancel_reason: 'Wrong student',
      cancelled_by_name: 'Owner',
      covers: '',
    });
    expect(d.position).toMatchObject({ paid: 1900, counter_discount: 100, pending: 11200 });
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM receipts').first<{ n: number }>();
    expect(rows!.n).toBe(4); // nothing deleted
    // the cancelled number is not reused
    await pay(owner, e, 100);
    expect((await owner.get(`/fees/students/${e}`)).data.receipts[0].receipt_no).toBe('KMG-00004');
  });

  it('a student marked as left owes nothing further, and what they paid stays', async () => {
    const l = await addStudent('Leaver', 8, { roll_no: 6 });
    await pay(owner, l, 4400);
    const sid = (await owner.get(`/fees/students/${l}`)).data.student.student_id;
    await owner.put(`/enrolments/${l}`, {
      branch_id: 1,
      class_id: 8,
      section_id: await sectionId(1, 8),
      roll_no: 6,
      status: 'left',
      left_date: today,
    });
    const d = (await owner.get(`/fees/students/${l}`)).data;
    expect(d.position).toMatchObject({ paid: 4400, pending: 0, overdue: 0 });
    expect((await pay(owner, l, 100)).data.error).toMatch(/has left the school/);
    expect(sid).toBeGreaterThan(0);
  });
});

describe('lists, dashboard and reports agree with the student page', () => {
  it('collect list: overdue students by default, search otherwise', async () => {
    const list = (await owner.get('/fees/collect?session_id=1')).data;
    expect(list.total).toBeGreaterThan(3);
    expect(list.rows.every((r: any) => r.overdue > 0)).toBe(true);
    expect(list.rows.map((r: any) => r.name)).not.toContain('Leaver');
    for (const row of list.rows.slice(0, 5)) {
      const d = (await owner.get(`/fees/students/${row.enrolment_id}`)).data;
      expect([row.name, row.pending, row.overdue]).toEqual([
        d.student.name,
        d.position.pending,
        d.position.overdue,
      ]);
    }
    const found = (await owner.get('/fees/collect?session_id=1&q=payer')).data.rows;
    expect(found.map((r: any) => r.name)).toEqual(['Payer Kumar']);
  });

  it('dashboard totals add up', async () => {
    const dash = (await owner.get('/fees/dashboard?session_id=1')).data;
    const register = (await owner.get('/fees/reports/register?session_id=1')).data.rows;
    const sum = (key: string) => register.reduce((t: number, r: any) => t + r[key], 0);
    expect(dash.total.students).toBe(register.length);
    expect(dash.total).toMatchObject({
      fee: sum('fee'),
      net: sum('net'),
      paid: sum('paid'),
      pending: sum('pending'),
      overdue: sum('overdue'),
      counter_discount: 100,
    });
    expect(dash.total.paid).toBe(1900 + 100 + 500 + 4400);
    expect(dash.today).toBe(dash.total.paid);
    expect(dash.last_7_days).toBe(dash.total.paid);
    expect(dash.this_month).toBe(dash.total.paid);
    expect(dash.by_month).toHaveLength(12);
    expect(dash.by_month.reduce((t: number, m: any) => t + m.amount, 0)).toBe(dash.total.paid);
    expect(dash.last_14_days).toHaveLength(14);
    expect(dash.last_14_days[13]).toEqual({ date: today, amount: dash.total.paid });
    expect(dash.by_mode.find((m: any) => m.mode === 'upi')).toEqual({
      mode: 'upi',
      amount: 1000,
      receipts: 1,
    });
    expect(dash.by_branch).toHaveLength(2);
    expect(dash.by_branch.reduce((t: number, b: any) => t + b.paid, 0)).toBe(dash.total.paid);
    expect(dash.largest_dues[0].overdue).toBeGreaterThanOrEqual(dash.largest_dues[1].overdue);
    expect(dash.latest_receipts[0]).toMatchObject({ receipt_no: 'KMG-00005' });
    expect(dash.latest_receipts.some((r: any) => r.cancelled === 1)).toBe(true);
    expect(dash.missing_fees).toBe(0);
    const one = (await owner.get(`/fees/dashboard?session_id=1&branch_id=${branch2}`)).data;
    expect(one.total).toMatchObject({ students: 1, paid: 500 });
  });

  it('runs every report', async () => {
    const run = async (name: string, extra = '') =>
      (await owner.get(`/fees/reports/${name}?session_id=1${extra}`)).data;
    const collection = await run('collection');
    expect(collection.rows.map((r: any) => r.receipt_no)).toEqual([
      'KMG-00002',
      'KNJ-00001',
      'KMG-00003',
      'KMG-00004',
      'KMG-00005',
    ]);
    expect((await run('collection', '&mode=upi')).rows).toHaveLength(1);
    expect((await run('collection', `&branch_id=${branch2}`)).rows).toHaveLength(1);
    expect((await run('daywise')).rows).toEqual([
      { date: today, receipts: 5, cash: 5900, upi: 1000, bank: 0, cheque: 0, total: 6900 },
    ]);
    const pendingToday = await run('pending');
    expect(pendingToday.rows.every((r: any) => r.amount > 0 && 'phone' in r)).toBe(true);
    const pendingYear = await run('pending', '&basis=year&min=15000');
    expect(pendingYear.rows.length).toBeGreaterThan(0);
    expect(pendingYear.rows.every((r: any) => r.amount >= 15000)).toBe(true);
    expect((await run('classwise')).rows.find((r: any) => r.class === 'Class 5')).toMatchObject({
      students: 3,
    });
    expect((await run('branchwise')).rows.map((r: any) => r.branch)).toEqual([
      'Kamalganj',
      'Kannauj',
    ]);
    const discounts = (await run('discounts')).rows;
    expect(discounts).toContainEqual({
      name: 'Nine New',
      class: 'Class 9 A',
      fee_type: 'Monthly fee',
      given_as: '25% every month',
      discount: 3600,
      reason: 'Sibling',
    });
    expect(discounts).toContainEqual({
      name: 'Nine New',
      class: 'Class 9 A',
      fee_type: 'Admission',
      given_as: '₹500',
      discount: 500,
      reason: 'Sibling',
    });
    expect(discounts.find((r: any) => r.fee_type === 'Counter discount')).toMatchObject({
      name: 'Payer Kumar',
      discount: 100,
      reason: 'Paid early',
    });
    expect((await run('staff')).rows).toEqual([
      {
        collected_by: 'Owner',
        receipts: 5,
        cash: 5900,
        upi: 1000,
        bank: 0,
        cheque: 0,
        total: 6900,
      },
    ]);
    expect((await run('cancelled')).rows).toMatchObject([
      { receipt_no: 'KMG-00001', amount: 4400, cancelled_by: 'Owner', reason: 'Wrong student' },
    ]);
    expect((await owner.get('/fees/reports/nope?session_id=1')).status).toBe(404);
    expect(
      (await owner.get('/fees/reports/collection?session_id=1&from=2026-12-01&to=2026-01-01'))
        .status,
    ).toBe(400);
  });
});

describe('who can do what', () => {
  let accountant: Client;
  let other: Client;
  let teacher: Client;
  let e: number;
  beforeAll(async () => {
    await owner.post('/users', {
      username: 'acct1',
      name: 'Acct One',
      role: 'accountant',
      branch_ids: [1],
      password: 'accountant-1',
    });
    await owner.post('/users', {
      username: 'acct2',
      name: 'Acct Two',
      role: 'accountant',
      branch_ids: [branch2],
      password: 'accountant-2',
    });
    await owner.post('/users', {
      username: 'teach1',
      name: 'Teacher',
      role: 'teacher',
      branch_ids: [1],
      password: 'teacher-11',
    });
    accountant = await signIn('acct1', 'accountant-1');
    other = await signIn('acct2', 'accountant-2');
    teacher = await signIn('teach1', 'teacher-11');
    e = await addStudent('Scope Fee', 5);
  });

  it('accountants collect in their own branch only and cannot cancel', async () => {
    const mine = await pay(accountant, e, 300);
    expect(mine.status).toBe(200);
    expect((await pay(other, e, 300)).status).toBe(403);
    expect((await other.get(`/fees/students/${e}`)).status).toBe(403);
    expect((await other.get(`/fees/receipts/${mine.data.id}`)).status).toBe(403);
    expect(
      (await accountant.post(`/fees/receipts/${mine.data.id}/cancel`, { reason: 'Mistake' }))
        .status,
    ).toBe(403);
    expect(
      (await other.get('/fees/collect?session_id=1')).data.rows.every(
        (r: any) => r.branch_id === branch2,
      ),
    ).toBe(true);
    expect((await other.get('/fees/dashboard?session_id=1')).data.total.students).toBe(1);
    expect((await other.get('/fees/dashboard?session_id=1&branch_id=1')).status).toBe(403);
    expect(
      (await other.get('/fees/reports/collection?session_id=1')).data.rows.map(
        (r: any) => r.receipt_no,
      ),
    ).toEqual(['KNJ-00001']);
    expect(
      (await other.get('/fees/rates?session_id=1')).data.every((r: any) => r.branch_id === branch2),
    ).toBe(true);
    expect(
      (
        await accountant.put('/fees/rates', {
          session_id: 1,
          branch_ids: [1],
          class_ids: [1],
          new: zero,
          old: zero,
        })
      ).status,
    ).toBe(403);
  });

  it('teachers have no access to fees', async () => {
    expect((await teacher.get('/fees/dashboard?session_id=1')).status).toBe(403);
    expect((await teacher.get(`/fees/students/${e}`)).status).toBe(403);
    expect((await pay(teacher, e, 100)).status).toBe(403);
  });

  it('answers 404 when the fees module is switched off in Settings', async () => {
    await owner.put('/settings', { modules: { fees: false } });
    expect((await owner.get('/fees/rates?session_id=1')).status).toBe(404);
    await owner.put('/settings', { modules: { fees: true } });
    expect((await owner.get('/fees/rates?session_id=1')).status).toBe(200);
  });
});

describe('new session and other ways students arrive', () => {
  it('copies each branch’s chart forward and gives promoted students fees as old students', async () => {
    await owner.post('/sessions', { start_year: 2027 });
    const next = (await owner.get('/bootstrap')).data.sessions.find(
      (s: any) => s.start_year === 2027,
    ).id;
    const rows = (await owner.get(`/fees/rates?session_id=${next}`)).data;
    expect(rows).toHaveLength(60);
    expect(rate(rows, 4, 'new', branch2)).toMatchObject({ registration: 150, monthly: 850 });
    expect(rate(rows, 12, 'new', 1)).toMatchObject({ monthly: 1500 });
    const cands = (
      await owner.get(
        `/promotion/candidates?from_session_id=1&to_session_id=${next}&branch_id=1&class_id=12`,
      )
    ).data;
    await owner.post('/promotion', {
      from_session_id: 1,
      to_session_id: next,
      branch_id: 1,
      class_id: 12,
      outcomes: cands.map((cd: any) => ({ enrolment_id: cd.enrolment_id, outcome: 'pass' })),
    });
    const moved = (await owner.get(`/students?session_id=${next}`)).data.rows;
    expect(moved.length).toBe(2);
    const d = (await owner.get(`/fees/students/${moved[0].enrolment_id}`)).data;
    expect(d.student.admission_type).toBe('old');
    expect(d.position).toMatchObject({
      net: 1200 + 2800 + 600 + 1200 * 12,
      paid: 0,
      due_today: 1200 + 2800 + 600,
    }); // Class 10 old; next session has not started
  });

  it('gives imported students their fees too', async () => {
    await owner.post('/students/import?commit=1', {
      branch_id: 1,
      session_id: 1,
      rows: [{ line: 2, name: 'Imported Kid', class: 'KG 1', admission_type: 'old' }],
    });
    const row = (await owner.get('/fees/collect?session_id=1&q=Imported')).data.rows[0];
    expect(row.pending).toBe(1800 + 700 * 12);
  });
});
