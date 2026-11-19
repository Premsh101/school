import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { planPromotion } from '../src/worker/core/promotion-routes';
import { validateImportRows } from '../src/worker/core/import-routes';
import { Client, sectionId, setupSchool } from './helpers';

let owner: Client;
const place = async (classId: number, roll: number | null = null, section = 'A') => ({
  branch_id: 1,
  class_id: classId,
  section_id: await sectionId(1, classId, section),
  roll_no: roll,
});

beforeAll(async () => {
  owner = await setupSchool();
});

describe('students', () => {
  let id: number;

  it('adds a student with an enrolment and the next admission number', async () => {
    const a = await owner.post('/students', {
      name: 'Asha Kumari',
      father_name: 'Ram Kumar',
      phone: '9876543210',
      dob: '2015-08-23',
      gender: 'female',
      admission_no: '500',
      session_id: 1,
      enrolment: await place(8, 1),
    });
    expect(a.status).toBe(200);
    id = a.data.id;
    const b = await owner.post('/students', {
      name: 'Bablu',
      session_id: 1,
      enrolment: await place(8, 2),
    });
    const detail = (await owner.get(`/students/${b.data.id}`)).data;
    expect(detail.student.admission_no).toBe('501');
    expect(detail.enrolments).toHaveLength(1);
    expect(detail.enrolments[0]).toMatchObject({
      session_name: '2026-27',
      class_id: 8,
      section_name: 'A',
      roll_no: 2,
      admission_type: 'new',
      status: 'studying',
    });
  });

  it('refuses a duplicate admission number or roll number, saying how to fix it', async () => {
    const dupAdm = await owner.post('/students', {
      name: 'C',
      admission_no: '500',
      session_id: 1,
      enrolment: await place(8, 3),
    });
    expect(dupAdm.status).toBe(409);
    expect(dupAdm.data.error).toMatch(/Admission number 500 is already used/);
    const dupRoll = await owner.post('/students', {
      name: 'C',
      session_id: 1,
      enrolment: await place(8, 1),
    });
    expect(dupRoll.status).toBe(409);
    expect(dupRoll.data.error).toMatch(/Roll number 1 is already given to Asha Kumari/);
    // nothing half-saved
    expect((await owner.get('/students?session_id=1')).data.total).toBe(2);
  });

  it('refuses a section from another class and bad input', async () => {
    const wrong = await owner.post('/students', {
      name: 'D',
      session_id: 1,
      enrolment: { ...(await place(8)), class_id: 9 },
    });
    expect(wrong.status).toBe(400);
    const bad = await owner.post('/students', {
      name: '',
      dob: '2015-02-30',
      session_id: 1,
      enrolment: await place(8),
    });
    expect(bad.status).toBe(400);
    expect(bad.data.fields).toHaveProperty('name');
    expect(bad.data.fields).toHaveProperty('dob');
  });

  it('searches by name, father, phone, admission number and roll', async () => {
    const find = async (q: string) =>
      (await owner.get(`/students?session_id=1&q=${encodeURIComponent(q)}`)).data.rows.map(
        (r: any) => r.name,
      );
    expect(await find('asha')).toEqual(['Asha Kumari']);
    expect(await find('ram ku')).toEqual(['Asha Kumari']);
    expect(await find('98765')).toEqual(['Asha Kumari']);
    expect(await find('501')).toEqual(['Bablu']);
    expect(await find('2')).toContain('Bablu');
    expect(await find('100%')).toEqual([]);
    expect((await owner.get('/students?session_id=1&class_id=9')).data.total).toBe(0);
  });

  it('edits details, moves section and marks a student as left', async () => {
    expect(
      (
        await owner.put(`/students/${id}`, {
          name: 'Asha Kumari',
          father_name: 'Ram Kumar Singh',
          phone: '9876543210',
        })
      ).status,
    ).toBe(200);
    await owner.post('/sections', { branch_id: 1, class_id: 8, name: 'B' });
    const enrolment = (await owner.get(`/students/${id}`)).data.enrolments[0];
    const moved = await owner.put(`/enrolments/${enrolment.id}`, {
      ...(await place(8, 1, 'B')),
      admission_type: 'old',
    });
    expect(moved.status).toBe(200);
    const future = await owner.put(`/enrolments/${enrolment.id}`, {
      ...(await place(8, 1, 'B')),
      status: 'left',
      left_date: '2999-01-01',
    });
    expect(future.status).toBe(400);
    await owner.put(`/enrolments/${enrolment.id}`, {
      ...(await place(8, 1, 'B')),
      status: 'left',
      left_date: '2026-10-05',
    });
    const after = (await owner.get(`/students/${id}`)).data;
    expect(after.student.father_name).toBe('Ram Kumar Singh');
    expect(after.enrolments[0]).toMatchObject({
      section_name: 'B',
      status: 'left',
      left_date: '2026-10-05',
    });
    expect((await owner.get('/students?session_id=1&status=studying')).data.total).toBe(1);
    expect((await owner.get('/home')).data.students).toEqual([{ branch_id: 1, count: 1 }]);
  });
});

describe('import validation (pure)', () => {
  const ctx = {
    classes: [{ id: 8, name: 'Class 5', sort_order: 8 }],
    sections: [{ id: 80, branch_id: 1, class_id: 8, name: 'A', active: 1 }],
    existingAdmissionNos: new Set(['77']),
    takenRolls: new Set(['80|4']),
    today: '2026-11-19',
  };
  const row = (over: Record<string, string | number>) => ({
    line: 2,
    admission_no: '',
    name: 'N',
    father_name: '',
    mother_name: '',
    phone: '',
    phone2: '',
    address: '',
    dob: '',
    gender: '',
    class: '5',
    section: '',
    roll_no: '',
    admission_type: '',
    ...over,
  });
  it('accepts a good row and fills defaults', () => {
    const { ready, errors } = validateImportRows(
      [row({ dob: '23/08/2015', gender: 'F', roll_no: '5', admission_type: 'Old' })],
      ctx,
    );
    expect(errors).toEqual([]);
    expect(ready[0]).toMatchObject({
      class_id: 8,
      section_id: 80,
      roll_no: 5,
      dob: '2015-08-23',
      gender: 'female',
      admission_type: 'old',
    });
  });
  it('reports every problem with the line number', () => {
    const { ready, errors } = validateImportRows(
      [
        row({ line: 2, name: '' }),
        row({ line: 3, class: '13' }),
        row({ line: 4, section: 'C' }),
        row({ line: 5, roll_no: '4' }),
        row({ line: 6, roll_no: '9' }),
        row({ line: 7, roll_no: '9' }),
        row({ line: 8, admission_no: '77' }),
        row({ line: 9, dob: '31/02/2015', gender: 'x', phone: 'abc' }),
        row({ line: 10 }),
      ],
      ctx,
    );
    expect(ready.map((r) => r.line)).toEqual([6, 10]);
    const msg = Object.fromEntries(errors.map((e) => [e.line, e.message]));
    expect(msg[2]).toMatch(/Name is empty/);
    expect(msg[3]).toMatch(/not known/);
    expect(msg[4]).toMatch(/Section C does not exist/);
    expect(msg[5]).toMatch(/already used/);
    expect(msg[7]).toMatch(/appears twice/);
    expect(msg[8]).toMatch(/already in the system/);
    expect(msg[9]).toMatch(/not a date.*Gender.*Phone/);
  });
});

describe('import', () => {
  const rows = [
    {
      line: 2,
      admission_no: '900',
      name: 'Imp One',
      class: '3',
      roll_no: '1',
      dob: '01/05/2017',
      gender: 'M',
    },
    {
      line: 3,
      admission_no: '',
      name: 'Imp Two',
      class: 'III',
      roll_no: '2',
      admission_type: 'old',
    },
    { line: 4, admission_no: '', name: 'Imp Three', class: 'KG 1' },
  ];
  it('previews without saving', async () => {
    const res = await owner.post('/students/import', { branch_id: 1, session_id: 1, rows });
    expect(res.data).toEqual({ errors: [], valid: 3, imported: 0 });
    expect((await owner.get('/students?session_id=1&q=Imp')).data.total).toBe(0);
  });
  it('saves nothing from a chunk that has an error', async () => {
    const res = await owner.post('/students/import?commit=1', {
      branch_id: 1,
      session_id: 1,
      rows: [...rows, { line: 5, name: '', class: '3' }],
    });
    expect(res.data.imported).toBe(0);
    expect(res.data.errors).toHaveLength(1);
    expect((await owner.get('/students?session_id=1&q=Imp')).data.total).toBe(0);
  });
  it('saves a clean chunk and numbers students without an admission number', async () => {
    const res = await owner.post('/students/import?commit=1', {
      branch_id: 1,
      session_id: 1,
      rows,
    });
    expect(res.data.imported).toBe(3);
    const list = (await owner.get('/students?session_id=1&q=Imp')).data.rows;
    expect(
      list.map((r: any) => [r.name, r.class_id, r.roll_no, r.admission_type, r.admission_no]),
    ).toEqual([
      ['Imp Three', 2, null, 'new', '902'],
      ['Imp One', 6, 1, 'new', '900'],
      ['Imp Two', 6, 2, 'old', '901'],
    ]);
    const again = await owner.post('/students/import', { branch_id: 1, session_id: 1, rows });
    expect(again.data.errors.map((e: any) => e.line)).toEqual([2, 3]);
  });
});

describe('import across chunks', () => {
  it('numbers blank admission numbers after the highest number in the whole file', async () => {
    const res = await owner.post('/students/import?commit=1', {
      branch_id: 1,
      session_id: 1,
      auto_after: 5000,
      rows: [{ line: 2, name: 'Chunk Kid', class: '1' }],
    });
    expect(res.data.imported).toBe(1);
    const list = (await owner.get('/students?session_id=1&q=Chunk')).data.rows;
    expect(list[0].admission_no).toBe('5001');
  });
});

describe('promotion planning (pure)', () => {
  const classes = [
    { id: 14, name: 'Class 11', sort_order: 14 },
    { id: 15, name: 'Class 12', sort_order: 15 },
  ];
  const cand = (id: number, over = {}) => ({
    enrolment_id: id,
    student_id: id + 100,
    section_name: 'A',
    roll_no: id,
    status: 'studying' as const,
    already_moved: 0,
    ...over,
  });
  it('moves passes up, keeps fails, numbers rolls after existing ones', () => {
    const plan = planPromotion(
      [
        { enrolment_id: 3, outcome: 'pass' },
        { enrolment_id: 1, outcome: 'pass' },
        { enrolment_id: 2, outcome: 'fail' },
        { enrolment_id: 4, outcome: 'left' },
        { enrolment_id: 5, outcome: 'pass' },
        { enrolment_id: 6, outcome: 'pass' },
      ],
      [
        cand(1),
        cand(2),
        cand(3, { section_name: 'B' }),
        cand(4),
        cand(5, { already_moved: 1 }),
        cand(6, { status: 'left' }),
      ],
      14,
      classes,
      [
        { class_id: 15, name: 'A', max_roll: 7 },
        { class_id: 14, name: 'A', max_roll: null },
      ],
    );
    expect(plan.moves).toEqual([
      { student_id: 101, class_id: 15, section_name: 'A', roll_no: 8 },
      { student_id: 102, class_id: 14, section_name: 'A', roll_no: 1 },
      { student_id: 103, class_id: 15, section_name: 'B', roll_no: 1 },
    ]);
    expect(plan.sections).toEqual([{ class_id: 15, name: 'B' }]);
    expect(plan.results).toEqual([
      { id: 1, result: 'pass' },
      { id: 2, result: 'fail' },
      { id: 3, result: 'pass' },
    ]);
    expect(plan.left).toEqual([4]);
    expect(plan.summary).toEqual({ promoted: 2, repeating: 1, passed_out: 0, left: 2, skipped: 1 });
  });
  it('passes out the top class', () => {
    const plan = planPromotion(
      [
        { enrolment_id: 1, outcome: 'pass' },
        { enrolment_id: 2, outcome: 'fail' },
      ],
      [cand(1), cand(2)],
      15,
      classes,
      [],
    );
    expect(plan.moves).toEqual([{ student_id: 102, class_id: 15, section_name: 'A', roll_no: 1 }]);
    expect(plan.summary).toMatchObject({ passed_out: 1, repeating: 1 });
  });
});

describe('promotion to the next session', () => {
  let ids: number[];
  let next: number;
  it('needs the next session to be opened first', async () => {
    const made = [];
    for (const [i, name] of ['Pass Kid', 'Fail Kid', 'Left Kid'].entries()) {
      made.push(
        (await owner.post('/students', { name, session_id: 1, enrolment: await place(11, i + 1) }))
          .data.id,
      );
    }
    ids = made;
    expect((await owner.post('/sessions', { start_year: 2028 })).status).toBe(200);
    const far = (await owner.get('/bootstrap')).data.sessions.find(
      (s: any) => s.start_year === 2028,
    ).id;
    const cands = (
      await owner.get(
        `/promotion/candidates?from_session_id=1&to_session_id=${far}&branch_id=1&class_id=11`,
      )
    ).data;
    expect(cands).toHaveLength(3);
    const res = await owner.post('/promotion', {
      from_session_id: 1,
      to_session_id: far,
      branch_id: 1,
      class_id: 11,
      outcomes: cands.map((cd: any) => ({ enrolment_id: cd.enrolment_id, outcome: 'pass' })),
    });
    expect(res.status).toBe(400);
    expect(res.data.error).toMatch(/session that comes right after/);
  });

  it('moves a class by pass / fail / left and keeps the history', async () => {
    expect((await owner.post('/sessions', { start_year: 2027 })).status).toBe(200);
    expect((await owner.post('/sessions', { start_year: 2027 })).status).toBe(409);
    next = (await owner.get('/bootstrap')).data.sessions.find((s: any) => s.start_year === 2027).id;
    const cands = (
      await owner.get(
        `/promotion/candidates?from_session_id=1&to_session_id=${next}&branch_id=1&class_id=11`,
      )
    ).data;
    const outcome = (name: string) =>
      name === 'Pass Kid' ? 'pass' : name === 'Fail Kid' ? 'fail' : 'left';
    const body = {
      from_session_id: 1,
      to_session_id: next,
      branch_id: 1,
      class_id: 11,
      outcomes: cands.map((cd: any) => ({
        enrolment_id: cd.enrolment_id,
        outcome: outcome(cd.name),
      })),
    };
    const res = await owner.post('/promotion', body);
    expect(res.data).toEqual({ promoted: 1, repeating: 1, passed_out: 0, left: 1, skipped: 0 });

    const [pass, fail, left] = await Promise.all(
      ids.map(async (sid) => (await owner.get(`/students/${sid}`)).data.enrolments),
    );
    // newest session first; the old year stays as history with its result
    expect(pass.map((e: any) => [e.session_name, e.class_id, e.result, e.admission_type])).toEqual([
      ['2027-28', 12, null, 'old'],
      ['2026-27', 11, 'pass', 'new'],
    ]);
    expect(fail.map((e: any) => [e.session_name, e.class_id, e.result])).toEqual([
      ['2027-28', 11, null],
      ['2026-27', 11, 'fail'],
    ]);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ status: 'left', result: null });
    expect(left[0].left_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // running it again changes nothing
    const again = await owner.post('/promotion', body);
    expect(again.data).toMatchObject({ promoted: 0, repeating: 0, skipped: 2, left: 1 });
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM enrolments WHERE session_id = ?')
      .bind(next)
      .first<{ n: number }>();
    expect(count!.n).toBe(2);
    expect((await owner.get(`/students?session_id=${next}`)).data.total).toBe(2);
  });

  it('makes the new session current', async () => {
    await owner.post(`/sessions/${next}/current`);
    const sessions = (await owner.get('/bootstrap')).data.sessions;
    expect(sessions.filter((s: any) => s.is_current).map((s: any) => s.name)).toEqual(['2027-28']);
  });
});
