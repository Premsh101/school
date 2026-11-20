import { beforeAll, describe, expect, it } from 'vitest';
import { todayIST } from '../src/shared/dates';
import { Client, sectionId, setupSchool } from './helpers';

let owner: Client;
const today = todayIST();
const ids: Record<string, number> = {};

async function addStudent(name: string, classId: number, gender: string, type: 'new' | 'old') {
  const res = await owner.post('/students', {
    name,
    gender,
    phone: '9000000001',
    session_id: 1,
    enrolment: {
      branch_id: 1,
      class_id: classId,
      section_id: await sectionId(1, classId),
      admission_type: type,
    },
  });
  expect(res.status, JSON.stringify(res.data)).toBe(200);
  const detail = (await owner.get(`/students/${res.data.id}`)).data;
  ids[name] = detail.enrolments[0].id;
  return detail.enrolments[0].id as number;
}

beforeAll(async () => {
  owner = await setupSchool();
  await addStudent('Asha', 4, 'female', 'new');
  await addStudent('Bablu', 4, 'male', 'old');
  await addStudent('Chhaya', 8, 'female', 'new');
  const leaver = await addStudent('Dinesh', 8, 'male', 'old');
  await owner.put(`/enrolments/${leaver}`, {
    branch_id: 1,
    class_id: 8,
    section_id: await sectionId(1, 8),
    status: 'left',
    left_date: today,
    admission_type: 'old',
  });
  await owner.post('/fees/receipts', {
    enrolment_id: ids.Asha,
    date: today,
    settle_amount: 1000,
    mode: 'cash',
  });
  await owner.post('/fees/receipts', {
    enrolment_id: ids.Bablu,
    date: today,
    settle_amount: 500,
    mode: 'upi',
    reference: 'UPI1',
  });
});

describe('home dashboard numbers', () => {
  it('counts students by class, boys and girls, new and old, and those who left', async () => {
    const home = (await owner.get('/home?session_id=1')).data;
    expect(home.students).toEqual([{ branch_id: 1, count: 3 }]);
    expect(home.by_class.sort((a: any, b: any) => a.class_id - b.class_id)).toEqual([
      { class_id: 4, count: 2, boys: 1, girls: 1 },
      { class_id: 8, count: 1, boys: 0, girls: 1 },
    ]);
    expect(home).toMatchObject({ new_admissions: 2, old_students: 1, left: 1 });
  });
});

describe('fee dashboard filters', () => {
  it('counts collections in the date range, by mode and by day', async () => {
    const d = (await owner.get('/fees/dashboard?session_id=1')).data;
    expect(d.range).toMatchObject({
      from: '2026-04-01',
      to: today,
      collected: 1500,
      receipts: 2,
      previous_collected: null,
    });
    expect(d.range.days.at(-1)).toEqual({ date: today, amount: 1500 });
    expect(d.range.days[0].date).toBe('2026-04-01');
    expect(d.by_mode.sort((a: any, b: any) => a.amount - b.amount)).toEqual([
      { mode: 'upi', amount: 500, receipts: 1 },
      { mode: 'cash', amount: 1000, receipts: 1 },
    ]);
  });

  it('filters by payment mode and by class', async () => {
    const cash = (await owner.get('/fees/dashboard?session_id=1&mode=cash')).data;
    expect(cash.range.collected).toBe(1000);
    expect(cash.latest_receipts.every((r: any) => r.mode === 'cash')).toBe(true);
    const class5 = (await owner.get('/fees/dashboard?session_id=1&class_id=8')).data;
    expect(class5.total.students).toBe(2);
    expect(class5.range.collected).toBe(0);
    expect(class5.by_class.map((c: any) => c.class_id)).toEqual([8]);
  });

  it('compares with the same number of days just before the range', async () => {
    const d = (await owner.get(`/fees/dashboard?session_id=1&from=2026-06-01&to=2026-06-30`)).data;
    expect(d.range).toMatchObject({ collected: 0, receipts: 0, previous_collected: 0 });
    expect(d.range.days).toHaveLength(30);
    expect(
      (await owner.get('/fees/dashboard?session_id=1&from=2026-06-30&to=2026-06-01')).status,
    ).toBe(400);
  });

  it('spreads the fees falling due over the months for students still studying', async () => {
    const d = (await owner.get('/fees/dashboard?session_id=1')).data;
    expect(d.by_month).toHaveLength(12);
    let expected = 0;
    for (const name of ['Asha', 'Bablu', 'Chhaya']) {
      expected += (await owner.get(`/fees/students/${ids[name]}`)).data.position.net;
    }
    expect(d.by_month.reduce((t: number, m: any) => t + m.due, 0)).toBe(expected);
    // one-time charges fall in the first month
    expect(d.by_month[0].due).toBeGreaterThan(d.by_month[1].due);
    expect(d.by_month.find((m: any) => m.amount > 0).amount).toBe(1500);
  });
});

describe('student reports', () => {
  it('lists students who are studying, or everyone', async () => {
    const studying = (await owner.get('/reports/students?session_id=1')).data;
    expect(studying.rows.map((r: any) => r.name).sort()).toEqual(['Asha', 'Bablu', 'Chhaya']);
    expect(studying.columns.map((c: any) => c.key)).toContain('phone');
    const all = (await owner.get('/reports/students?session_id=1&status=all')).data;
    expect(all.rows).toHaveLength(4);
    const class1 = (await owner.get('/reports/students?session_id=1&class_id=4')).data;
    expect(class1.rows).toHaveLength(2);
  });

  it('shows class strength and students who left', async () => {
    const strength = (await owner.get('/reports/strength?session_id=1')).data;
    expect(strength.rows).toEqual([
      {
        branch: 'Kamalganj',
        class: 'Class 1',
        section: 'A',
        total: 2,
        boys: 1,
        girls: 1,
        new: 1,
        old: 1,
        left: 0,
      },
      {
        branch: 'Kamalganj',
        class: 'Class 5',
        section: 'A',
        total: 1,
        boys: 0,
        girls: 1,
        new: 1,
        old: 0,
        left: 1,
      },
    ]);
    const left = (await owner.get('/reports/left?session_id=1')).data;
    expect(left.rows.map((r: any) => [r.name, r.left_date])).toEqual([['Dinesh', today]]);
    expect((await owner.get('/reports/nope?session_id=1')).status).toBe(404);
  });
});
