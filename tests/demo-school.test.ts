import { beforeAll, describe, expect, it } from 'vitest';
import { Client, sectionId, setupSchool, signIn, OWNER } from './helpers';

describe('a demo school is left out of "All schools"', () => {
  let all: Client;
  let demo: Client;
  let demoId: number;
  let demoStudent: number;

  beforeAll(async () => {
    all = await setupSchool();
    const res = await all.post('/branches', { name: 'Demo School', code: 'DEMO', is_demo: true });
    expect(res.status).toBe(200);
    const boot = (await all.get('/bootstrap')).data;
    demoId = boot.my_branches.find((b: { code: string }) => b.code === 'DEMO').id;
    demo = await signIn(OWNER.username, OWNER.password, demoId);
    const add = async (c: Client, branch: number, name: string) => {
      const r = await c.post('/students', {
        name,
        session_id: 1,
        enrolment: {
          branch_id: branch,
          class_id: 8,
          section_id: await sectionId(branch, 8),
          admission_type: 'new',
        },
      });
      expect(r.status, JSON.stringify(r.data)).toBe(200);
      return r.data.id as number;
    };
    await add(demo, demoId, 'Sample Child');
    demoStudent = (await demo.get('/students?session_id=1')).data.rows[0].student_id ?? 0;
    const kmg = await signIn(OWNER.username, OWNER.password, 1);
    await add(kmg, 1, 'Real Child');
  });

  it('is offered in the school switcher but not counted in All schools', async () => {
    const boot = (await all.get('/bootstrap')).data;
    expect(boot.my_branches.map((b: { code: string }) => b.code)).toEqual(['KMG', 'DEMO']);
    expect(boot.branches.map((b: { code: string }) => b.code)).toEqual(['KMG']);
    const login = (await new Client().get('/bootstrap')).data.login_branches;
    expect(login.map((b: { name: string }) => b.name)).toEqual(['Kamalganj', 'Demo School']);
  });

  it('keeps demo students out of All schools lists, totals and reports', async () => {
    const list = (await all.get('/students?session_id=1')).data;
    expect(list.rows.map((r: { name: string }) => r.name)).toEqual(['Real Child']);
    const home = (await all.get('/home?session_id=1')).data;
    expect(home.students).toEqual([{ branch_id: 1, count: 1 }]);
    const dash = (await all.get('/fees/dashboard?session_id=1')).data;
    expect(dash.by_branch.map((b: { branch_id: number }) => b.branch_id)).toEqual([1]);
    const report = (await all.get('/reports/students?session_id=1')).data;
    expect(report.rows).toHaveLength(1);
  });

  it('shows only demo data when the demo school is chosen', async () => {
    const list = (await demo.get('/students?session_id=1')).data;
    expect(list.rows.map((r: { name: string }) => r.name)).toEqual(['Sample Child']);
    expect(demoStudent).toBeGreaterThan(0);
    expect((await all.get(`/students/${demoStudent}`)).status).toBe(403);
    expect((await demo.get(`/students/${demoStudent}`)).status).toBe(200);
  });

  it('lets the admin mark a school as demo or real', async () => {
    const res = await all.put(`/branches/${demoId}`, {
      name: 'Demo School',
      code: 'DEMO',
      active: true,
      is_demo: false,
    });
    expect(res.status).toBe(200);
    const list = (await all.get('/students?session_id=1')).data;
    expect(list.total).toBe(2);
    await all.put(`/branches/${demoId}`, {
      name: 'Demo School',
      code: 'DEMO',
      active: true,
      is_demo: true,
    });
  });
});
