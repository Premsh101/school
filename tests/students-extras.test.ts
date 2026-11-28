import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { addLogin, Client, sectionId, setupSchool, signIn } from './helpers';

let owner: Client;
let counter: Client;

async function add(name: string, extra: Record<string, unknown> = {}) {
  const res = await owner.post('/students', {
    name,
    session_id: 1,
    enrolment: { branch_id: 1, class_id: 4, section_id: await sectionId(1, 4) },
    ...extra,
  });
  expect(res.status, JSON.stringify(res.data)).toBe(200);
  const detail = (await owner.get(`/students/${res.data.id}`)).data;
  return { student: res.data.id as number, enrolment: detail.enrolments[0].id as number };
}

beforeAll(async () => {
  owner = await setupSchool();
  await addLogin(owner, {
    username: 'counter',
    name: 'Counter',
    role: 'accountant',
    password: 'counter-pass-1',
    branch_ids: [1],
  });
  counter = await signIn('counter', 'counter-pass-1', 1);
});

describe('gender', () => {
  it('is male or female, or not set; "other" is no longer accepted', async () => {
    expect((await add('Boy One', { gender: 'male' })).student).toBeGreaterThan(0);
    expect((await add('Girl One', { gender: 'female' })).student).toBeGreaterThan(0);
    expect((await add('No Gender')).student).toBeGreaterThan(0);
    // An unknown value is refused.
    const bad = await owner.post('/students', {
      name: 'Bad Gender',
      gender: 'robot',
      session_id: 1,
      enrolment: { branch_id: 1, class_id: 4, section_id: await sectionId(1, 4) },
    });
    expect(bad.status).toBe(400);
  });

  it('reads a leftover "other" as not set, so that student can still be edited', async () => {
    const { student } = await add('Old Other', { gender: 'male' });
    await env.DB.prepare("UPDATE students SET gender = 'other' WHERE id = ?").bind(student).run();
    const shown = (await owner.get(`/students/${student}`)).data.student;
    expect(shown.gender).toBe('other'); // what the old release saved
    // The edit form sends the stored value back unchanged.
    const res = await owner.put(`/students/${student}`, { ...shown, phone: '9876501234' });
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    expect((await owner.get(`/students/${student}`)).data.student).toMatchObject({
      gender: '',
      phone: '9876501234',
    });
  });

  it('is read as male or female from an import file', async () => {
    const row = (line: number, gender: string) => ({
      line,
      name: `Import ${line}`,
      class: '1',
      gender,
    });
    const res = await owner.post('/students/import', {
      branch_id: 1,
      session_id: 1,
      rows: [row(1, 'Male'), row(2, 'girl'), row(3, 'Other')],
      auto_after: 0,
    });
    const text = JSON.stringify(res.data.errors);
    expect(res.data.valid).toBe(2);
    expect(text).toMatch(/Use Male or Female/);
    expect(res.data.errors).toHaveLength(1);
  });
});

describe('cancelling a registration', () => {
  it('marks the student as left with the reason, and keeps what they paid', async () => {
    const { student, enrolment } = await add('Will Cancel');
    expect(
      (
        await counter.post('/fees/receipts', {
          enrolment_id: enrolment,
          date: new Date().toISOString().slice(0, 10),
          settle_amount: 600,
          mode: 'cash',
        })
      ).status,
    ).toBe(200);
    // The accountant can look students up but not change them.
    expect(
      (await counter.post(`/enrolments/${enrolment}/cancel-registration`, { reason: 'Moved away' }))
        .status,
    ).toBe(403);
    expect(
      (await owner.post(`/enrolments/${enrolment}/cancel-registration`, { reason: '' })).status,
    ).toBe(400);
    const res = await owner.post(`/enrolments/${enrolment}/cancel-registration`, {
      reason: 'Family moved to Delhi',
    });
    expect(res.status, JSON.stringify(res.data)).toBe(200);

    const e = (await owner.get(`/students/${student}`)).data.enrolments[0];
    expect(e).toMatchObject({ status: 'left', cancel_reason: 'Family moved to Delhi' });
    expect(e.left_date).toBeTruthy();
    // They owe nothing further, and the money already taken stays.
    const fees = (await owner.get(`/fees/students/${enrolment}`)).data;
    expect(fees.position).toMatchObject({ pending: 0, overdue: 0, paid: 600 });
    expect(fees.student.cancel_reason).toBe('Family moved to Delhi');
    expect(
      (
        await counter.post('/fees/receipts', {
          enrolment_id: enrolment,
          date: new Date().toISOString().slice(0, 10),
          settle_amount: 100,
          mode: 'cash',
        })
      ).status,
    ).toBe(400);
    // The leavers report says why.
    const left = (await owner.get('/reports/left?session_id=1')).data;
    expect(left.rows.find((r: any) => r.name === 'Will Cancel')).toMatchObject({
      reason: 'Family moved to Delhi',
    });
    const log = (await owner.get('/audit')).data.rows[0];
    expect(log).toMatchObject({ action: 'cancel', entity: 'enrolment' });
    expect(log.summary).toMatch(/Cancelled the registration of Will Cancel: Family moved to Delhi/);
  });

  it('cannot be done twice, and is undone by putting the student back as studying', async () => {
    const { student, enrolment } = await add('Changes Mind');
    expect(
      (await owner.post(`/enrolments/${enrolment}/cancel-registration`, { reason: 'Not coming' }))
        .status,
    ).toBe(200);
    expect(
      (await owner.post(`/enrolments/${enrolment}/cancel-registration`, { reason: 'Again' }))
        .status,
    ).toBe(409);
    const e = (await owner.get(`/students/${student}`)).data.enrolments[0];
    const back = await owner.put(`/enrolments/${enrolment}`, {
      branch_id: e.branch_id,
      class_id: e.class_id,
      section_id: e.section_id,
      roll_no: e.roll_no,
      admission_type: e.admission_type,
      status: 'studying',
    });
    expect(back.status, JSON.stringify(back.data)).toBe(200);
    expect((await owner.get(`/students/${student}`)).data.enrolments[0]).toMatchObject({
      status: 'studying',
      cancel_reason: null,
    });
  });

  it('is not allowed in the future', async () => {
    const { enrolment } = await add('Future Date');
    const res = await owner.post(`/enrolments/${enrolment}/cancel-registration`, {
      reason: 'Later',
      date: '2099-01-01',
    });
    expect(res.status).toBe(400);
  });
});
