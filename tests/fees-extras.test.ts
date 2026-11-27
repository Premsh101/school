import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { todayIST } from '../src/shared/dates';
import { lateFee } from '../src/shared/fees';
import { addLogin, Client, sectionId, setupSchool, signIn } from './helpers';

let owner: Client;
let accountant: Client;
let manager: Client;
const today = todayIST();
const session = { start_year: 2026, start_month: 4 };

async function addStudent(name: string, classId = 4, over: Record<string, unknown> = {}) {
  const res = await owner.post('/students', {
    name,
    phone: '9876500000',
    session_id: 1,
    enrolment: {
      branch_id: 1,
      class_id: classId,
      section_id: await sectionId(1, classId),
      admission_type: 'new',
      ...over,
    },
  });
  expect(res.status, JSON.stringify(res.data)).toBe(200);
  const detail = (await owner.get(`/students/${res.data.id}`)).data;
  return detail.enrolments[0].id as number;
}
/** Makes a student look as if they joined before the session began, so every month can carry a late fee. */
const joinedEarly = (enrolment: number) =>
  env.DB.prepare("UPDATE enrolments SET created_at = '2026-03-01T00:00:00.000Z' WHERE id = ?")
    .bind(enrolment)
    .run();
const fees = async (enrolment: number) => (await owner.get(`/fees/students/${enrolment}`)).data;
const pay = (client: Client, enrolment_id: number, settle_amount: number, over = {}) =>
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
  await addLogin(owner, {
    username: 'counter',
    name: 'Counter',
    role: 'accountant',
    password: 'counter-pass-1',
    branch_ids: [1],
  });
  await addLogin(owner, {
    username: 'manager',
    name: 'Manager',
    role: 'management',
    password: 'manager-pass-1',
  });
  accountant = await signIn('counter', 'counter-pass-1', 1);
  manager = await signIn('manager', 'manager-pass-1', null);
});

describe('late fee at the counter', () => {
  let e: number;
  let owed: number;

  beforeAll(async () => {
    e = await addStudent('Late Payer');
    await joinedEarly(e);
    const d = await fees(e);
    owed = d.late_fee.outstanding;
  });

  it('shows what is owed and agrees with the pure rules', async () => {
    const d = await fees(e);
    const expected = lateFee(d.plan, session, [], today, {
      paid: 0,
      waived: 0,
      joinedOn: '2026-03-01',
    });
    expect(owed).toBeGreaterThan(0);
    expect(d.late_fee.accrued).toBe(expected.accrued);
    expect(d.late_fee.outstanding).toBe(expected.accrued);
    expect(d.late_fee.months[0]).toMatchObject({
      month: 4,
      due_date: '2026-04-20',
      cleared_on: null,
    });
    // It also shows on the collect list, so the counter sees it before opening the student.
    const list = (await accountant.get('/fees/collect?session_id=1&q=Late Payer')).data.rows;
    expect(list[0].late_fee).toBe(owed);
  });

  it('takes the late fee next to the fees, and counts it as cash received', async () => {
    const before = await fees(e);
    const res = await pay(accountant, e, 1000, { late_fee: owed });
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    const d = await fees(e);
    const receipt = d.receipts[0];
    expect(receipt).toMatchObject({ amount: 1000 + owed, late_fee: owed });
    // The fees cleared are the 1,000, not the late fee.
    expect(d.position.paid).toBe(1000);
    expect(d.position.pending).toBe(before.position.pending - 1000);
    expect(d.late_fee.paid).toBe(owed);
    expect(d.late_fee.outstanding).toBeLessThan(owed); // the rest is what built up since
    expect(receipt.covers).not.toBe('');
  });

  it('refuses more late fee than is owed', async () => {
    const d = await fees(e);
    const res = await pay(accountant, e, 100, { late_fee: d.late_fee.outstanding + 1 });
    expect(res.status).toBe(400);
    expect(res.data.fields.late_fee).toBeTruthy();
  });

  it('takes a late fee on its own, with no fees', async () => {
    const e2 = await addStudent('Only Late Fee');
    await joinedEarly(e2);
    const due = (await fees(e2)).late_fee.outstanding;
    const res = await pay(accountant, e2, 0, { late_fee: due });
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    const d = await fees(e2);
    expect(d.position.paid).toBe(0);
    expect(d.late_fee.outstanding).toBe(0);
    expect((await pay(accountant, e2, 0)).status).toBe(400); // nothing to take at all
  });

  it('brings the late fee back when the receipt is cancelled', async () => {
    const e3 = await addStudent('Cancelled Late');
    await joinedEarly(e3);
    const due = (await fees(e3)).late_fee.outstanding;
    const res = await pay(accountant, e3, 500, { late_fee: due });
    expect((await fees(e3)).late_fee.outstanding).toBe(0);
    expect(res.status).toBe(200);
    const receipt = (await fees(e3)).receipts[0];
    expect(
      (await manager.post(`/fees/receipts/${receipt.id}/cancel`, { reason: 'Wrong student' }))
        .status,
    ).toBe(200);
    const d = await fees(e3);
    expect(d.late_fee.paid).toBe(0);
    expect(d.late_fee.outstanding).toBe(due);
    expect(d.position.paid).toBe(0);
  });

  it('is waived by admin or management with a reason, and never by the accountant', async () => {
    const e4 = await addStudent('Waived Late');
    await joinedEarly(e4);
    const due = (await fees(e4)).late_fee.outstanding;
    expect(
      (await accountant.post(`/fees/students/${e4}/late-fee-waiver`, { reason: 'Poor family' }))
        .status,
    ).toBe(403);
    expect(
      (await manager.post(`/fees/students/${e4}/late-fee-waiver`, { reason: '' })).status,
    ).toBe(400);
    expect(
      (
        await manager.post(`/fees/students/${e4}/late-fee-waiver`, {
          amount: 10,
          reason: 'Poor family',
        })
      ).status,
    ).toBe(200);
    let d = await fees(e4);
    expect(d.late_fee.waived).toBe(10);
    expect(d.late_fee.outstanding).toBe(due - 10);
    expect(
      (await owner.post(`/fees/students/${e4}/late-fee-waiver`, { reason: 'Principal agreed' }))
        .status,
    ).toBe(200);
    d = await fees(e4);
    expect(d.late_fee.outstanding).toBe(0);
    expect(d.waivers.map((w: any) => [w.amount, w.reason, w.by_name])).toEqual([
      [due - 10, 'Principal agreed', 'Owner'],
      [10, 'Poor family', 'Manager'],
    ]);
    expect(
      (await manager.post(`/fees/students/${e4}/late-fee-waiver`, { reason: 'Again' })).status,
    ).toBe(400);
    const audit = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE summary LIKE 'Waived late fee%'",
    ).first<{ n: number }>();
    expect(audit!.n).toBe(2);
  });

  it('can be waived while paying, by management only', async () => {
    const e5 = await addStudent('Waived At Counter');
    await joinedEarly(e5);
    const due = (await fees(e5)).late_fee.outstanding;
    expect(due).toBeGreaterThan(0);
    expect((await pay(accountant, e5, 800, { waive_late_fee: true })).status).toBe(403);
    const res = await pay(manager, e5, 800, { waive_late_fee: true, note: 'Principal agreed' });
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    const d = await fees(e5);
    expect(d.receipts[0]).toMatchObject({ amount: 800, late_fee: 0 });
    expect(d.late_fee.waived).toBe(due);
    expect(d.late_fee.outstanding).toBe(0);
    expect(d.waivers[0]).toMatchObject({ amount: due, reason: 'Principal agreed' });
  });

  it('charges nothing for a student who has left', async () => {
    const e6 = await addStudent('Left Student');
    await joinedEarly(e6);
    expect((await fees(e6)).late_fee.outstanding).toBeGreaterThan(0);
    await env.DB.prepare(
      "UPDATE enrolments SET status = 'left', left_date = '2026-08-01' WHERE id = ?",
    )
      .bind(e6)
      .run();
    expect((await fees(e6)).late_fee.outstanding).toBe(0);
  });
});

describe('overall discount while paying', () => {
  it('comes off the total pending fees, on top of the money taken', async () => {
    const e = await addStudent('Overall Discount');
    const before = await fees(e);
    const pending = before.position.pending;
    const res = await pay(accountant, e, 1000, {
      discount_basis: 'total',
      counter_discount_type: 'percent',
      counter_discount_value: 10,
    });
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    const d = await fees(e);
    const discount = Math.round(pending / 10);
    expect(d.receipts[0]).toMatchObject({ amount: 1000, counter_discount: discount });
    expect(d.position.paid).toBe(1000);
    expect(d.position.counter_discount).toBe(discount);
    expect(d.position.pending).toBe(pending - 1000 - discount);
  });

  it('takes a rupee discount with no payment at all', async () => {
    const e = await addStudent('Discount Only');
    const pending = (await fees(e)).position.pending;
    const res = await pay(accountant, e, 0, {
      discount_basis: 'total',
      counter_discount_type: 'amount',
      counter_discount_value: 750,
    });
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    const d = await fees(e);
    expect(d.receipts[0]).toMatchObject({ amount: 0, counter_discount: 750 });
    expect(d.position.pending).toBe(pending - 750);
  });

  it('refuses a discount larger than what is pending, or payment plus discount over it', async () => {
    const e = await addStudent('Too Much');
    const pending = (await fees(e)).position.pending;
    const over = await pay(accountant, e, 0, {
      discount_basis: 'total',
      counter_discount_type: 'amount',
      counter_discount_value: pending + 1,
    });
    expect(over.status).toBe(400);
    const both = await pay(accountant, e, pending, {
      discount_basis: 'total',
      counter_discount_type: 'percent',
      counter_discount_value: 10,
    });
    expect(both.status).toBe(400);
    expect(both.data.fields.settle_amount).toBeTruthy();
  });

  it('keeps the old way: the discount comes out of the amount being cleared', async () => {
    const e = await addStudent('Old Way');
    const res = await pay(accountant, e, 1000, {
      counter_discount_type: 'percent',
      counter_discount_value: 10,
    });
    expect(res.status).toBe(200);
    expect((await fees(e)).receipts[0]).toMatchObject({ amount: 900, counter_discount: 100 });
  });
});

describe('transport', () => {
  let route: number;

  it('lets only the admin set up routes, per school', async () => {
    const body = {
      branch_id: 1,
      source: 'Kamalganj',
      destination: 'Farrukhabad',
      monthly_fee: 600,
    };
    expect((await accountant.post('/fees/transport-routes', body)).status).toBe(403);
    expect((await manager.post('/fees/transport-routes', body)).status).toBe(403);
    expect((await owner.post('/fees/transport-routes', body)).status).toBe(200);
    expect((await owner.post('/fees/transport-routes', body)).status).toBe(409); // same start and end
    const list = (await accountant.get('/fees/transport-routes')).data;
    expect(list).toMatchObject([
      { source: 'Kamalganj', destination: 'Farrukhabad', monthly_fee: 600, active: 1 },
    ]);
    route = list[0].id;
    expect(
      (await owner.put(`/fees/transport-routes/${route}`, { ...body, monthly_fee: 650 })).status,
    ).toBe(200);
  });

  it('adds the route fee to every month of the student, with a discount like any fee', async () => {
    const e = await addStudent('Bus Rider');
    const d = await fees(e);
    const monthly = d.plan.items.find((i: any) => i.type === 'monthly').amount;
    const res = await owner.put(`/fees/students/${e}`, {
      months: 12,
      discount_reason: 'Sibling',
      transport_route_id: route,
      items: items(d, { transport: { amount: 650, discount_type: 'percent', discount_value: 20 } }),
    });
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    const after = await fees(e);
    expect(after.transport).toEqual({ route_id: route, from: 'Kamalganj', to: 'Farrukhabad' });
    const net = monthly + 650 - 130;
    expect(after.position.net).toBe(d.position.net + (650 - 130) * 12);
    expect(after.quick.one_month).toBeLessThanOrEqual(net);
    // A month counts as paid only when tuition and transport are both paid.
    const firstMonth = after.plan.items.reduce(
      (sum: number, i: any) =>
        sum + (['monthly', 'transport'].includes(i.type) ? i.amount - i.discount : 0),
      0,
    );
    expect(firstMonth).toBe(net);
  });

  it('needs a route of the student’s own school for a transport fee', async () => {
    const e = await addStudent('No Route');
    const d = await fees(e);
    const noRoute = await owner.put(`/fees/students/${e}`, {
      months: 12,
      items: items(d, { transport: { amount: 500 } }),
    });
    expect(noRoute.status).toBe(400);
    expect(noRoute.data.fields.transport_route_id).toBeTruthy();
    expect(
      (
        await owner.put(`/fees/students/${e}`, {
          months: 12,
          transport_route_id: 9999,
          items: items(d),
        })
      ).status,
    ).toBe(400);
    // Removing the route again clears source and destination.
    expect(
      (
        await owner.put(`/fees/students/${e}`, {
          months: 12,
          transport_route_id: null,
          items: items(d),
        })
      ).status,
    ).toBe(200);
    expect((await fees(e)).transport).toBeNull();
  });
});

describe('previous dues', () => {
  it('are a one-time charge cleared before everything else, and can be discounted', async () => {
    const e = await addStudent('Old With Dues', 4, { admission_type: 'old' });
    const d = await fees(e);
    const res = await owner.put(`/fees/students/${e}`, {
      months: 12,
      discount_reason: '',
      items: items(d, { previous_dues: { amount: 3000 } }),
    });
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    const after = await fees(e);
    expect(after.position.net).toBe(d.position.net + 3000);
    expect(after.due_at_admission).toBe(d.due_at_admission + 3000);
    expect((await pay(accountant, e, 1000)).status).toBe(200);
    const paid = (await fees(e)).allocation.one_time;
    expect(paid[0]).toMatchObject({ type: 'previous_dues', paid: 1000, balance: 2000 });
    expect(paid.slice(1).every((c: any) => c.paid === 0)).toBe(true);
  });
});
