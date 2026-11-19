import { beforeAll, describe, expect, it } from 'vitest';
import { Client, setupSchool, signIn } from './helpers';

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
const rate = (rows: any[], classId: number, type: string) =>
  rows.find((r) => r.class_id === classId && r.admission_type === type);

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
    expect(rate(rows, 8, 'new')).toMatchObject({ admission: 3000, monthly: 800 });
    expect(rate(rows, 11, 'old')).toMatchObject({ annual: 2200, monthly: 900 });
    expect(rate(rows, 12, 'new')).toMatchObject({
      registration: 200,
      admission: 3500,
      board: 1000,
      practical: 600,
      tbdb: 700,
      monthly: 1200,
    });
    expect(rate(rows, 13, 'old')).toMatchObject({
      board: 1200,
      annual: 2800,
      practical: 600,
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

  it('lets the admin change the fees of chosen classes only', async () => {
    const res = await owner.put('/fees/rates', {
      session_id: 1,
      class_ids: [4, 5],
      new: { ...zero, registration: 150, admission: 3100, tbdb: 500, monthly: 850 },
      old: { ...zero, annual: 2100, monthly: 850 },
    });
    expect(res.status).toBe(200);
    const rows = (await owner.get('/fees/rates?session_id=1')).data;
    expect(rows).toHaveLength(30);
    expect(rate(rows, 4, 'new')).toMatchObject({
      registration: 150,
      admission: 3100,
      monthly: 850,
    });
    expect(rate(rows, 5, 'old')).toMatchObject({ annual: 2100, monthly: 850 });
    expect(rate(rows, 6, 'new')).toMatchObject({
      registration: 100,
      admission: 3000,
      monthly: 800,
    });
    const log = (await owner.get('/audit')).data.rows[0];
    expect(log.summary).toMatch(/fee rate chart of 2026-27 for Class 1, Class 2/);
  });

  it('refuses amounts that are not whole rupees, negative, or a lower "higher" practical', async () => {
    const put = (over: object) =>
      owner.put('/fees/rates', {
        session_id: 1,
        class_ids: [15],
        new: { ...zero, ...over },
        old: zero,
      });
    expect((await put({ monthly: 10.5 })).status).toBe(400);
    expect((await put({ monthly: -1 })).status).toBe(400);
    const alt = await put({ practical: 600, practical_alt: 500 });
    expect(alt.status).toBe(400);
    expect(alt.data.error).toMatch(/higher practical option must be more/);
    expect(
      (await owner.put('/fees/rates', { session_id: 1, class_ids: [99], new: zero, old: zero }))
        .status,
    ).toBe(400);
    expect(
      (await owner.put('/fees/rates', { session_id: 77, class_ids: [1], new: zero, old: zero }))
        .status,
    ).toBe(404);
  });

  it('copies the chart forward when a new session is opened, and keeps them separate', async () => {
    await owner.post('/sessions', { start_year: 2027 });
    const next = (await owner.get('/bootstrap')).data.sessions.find(
      (s: any) => s.start_year === 2027,
    ).id;
    let rows = (await owner.get(`/fees/rates?session_id=${next}`)).data;
    expect(rows).toHaveLength(30);
    expect(rate(rows, 4, 'new')).toMatchObject({ registration: 150, monthly: 850 }); // the edited value, not the printed one
    await owner.put('/fees/rates', {
      session_id: next,
      class_ids: [4],
      new: { ...zero, monthly: 900 },
      old: { ...zero, monthly: 900 },
    });
    rows = (await owner.get('/fees/rates?session_id=1')).data;
    expect(rate(rows, 4, 'new').monthly).toBe(850);
    // starting again never overwrites an existing chart
    await owner.post('/fees/rates/start', { session_id: next });
    rows = (await owner.get(`/fees/rates?session_id=${next}`)).data;
    expect(rows).toHaveLength(30);
    expect(rate(rows, 4, 'new').monthly).toBe(900);
  });

  it('lets principals and accountants see the chart but only the admin change it', async () => {
    await owner.post('/users', {
      username: 'principal9',
      name: 'P',
      role: 'principal',
      branch_ids: [1],
      password: 'principal-9',
    });
    await owner.post('/users', {
      username: 'teacher9',
      name: 'T',
      role: 'teacher',
      branch_ids: [1],
      password: 'teacher-99',
    });
    const principal = await signIn('principal9', 'principal-9');
    const teacher = await signIn('teacher9', 'teacher-99');
    expect((await principal.get('/fees/rates?session_id=1')).status).toBe(200);
    expect((await principal.get('/bootstrap')).data.user.permissions).toContain('fees.view');
    expect(
      (await principal.put('/fees/rates', { session_id: 1, class_ids: [1], new: zero, old: zero }))
        .status,
    ).toBe(403);
    expect((await principal.post('/fees/rates/start', { session_id: 1 })).status).toBe(403);
    expect((await teacher.get('/fees/rates?session_id=1')).status).toBe(403);
  });

  it('answers 404 when the fees module is switched off in Settings', async () => {
    expect((await owner.put('/settings', { modules: { fees: false } })).status).toBe(200);
    expect((await owner.get('/bootstrap')).data.modules).toEqual({ fees: false });
    expect((await owner.get('/fees/rates?session_id=1')).status).toBe(404);
    await owner.put('/settings', { modules: { fees: true } });
    expect((await owner.get('/fees/rates?session_id=1')).status).toBe(200);
  });
});
