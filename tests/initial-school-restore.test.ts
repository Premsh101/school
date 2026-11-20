import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, sectionId, signIn } from './helpers';

const count = async (table: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_SEED);
});

describe('restoring a backup onto a new installation', () => {
  let admin: Client;

  it('is refused unless the admin is signed in', async () => {
    expect((await new Client().post('/restore/begin')).status).toBe(403);
    admin = await signIn('admin@sps.com', 'admin@123', null);
    // the admin must choose their own password first
    expect((await admin.post('/restore/begin')).status).toBe(403);
    await admin.post('/auth/password', {
      current_password: 'admin@123',
      new_password: 'owner-own-pass-1',
    });
  });

  it('is refused once a student has been added, so live data is never overwritten', async () => {
    const res = await admin.post('/students', {
      name: 'First Kid',
      session_id: 1,
      enrolment: { branch_id: 1, class_id: 4, section_id: await sectionId(1, 4) },
    });
    expect(res.status).toBe(200);
    const begin = await admin.post('/restore/begin');
    expect(begin.status).toBe(403);
    expect(begin.data.error).toMatch(/before any students are added/);
    // take the student out again for the next test
    const id = res.data.id;
    await env.DB.batch([
      env.DB.prepare(
        'DELETE FROM student_fees WHERE enrolment_id IN (SELECT id FROM enrolments WHERE student_id = ?)',
      ).bind(id),
      env.DB.prepare('DELETE FROM enrolments WHERE student_id = ?').bind(id),
      env.DB.prepare('DELETE FROM students WHERE id = ?').bind(id),
    ]);
  });

  it('clears everything that came with the app, so the backup replaces it completely', async () => {
    // only the Demo School has students now, and sample data does not block a restore
    expect(await count('students')).toBe(45);
    expect((await admin.post('/restore/begin')).status).toBe(200);
    for (const table of [
      'branches',
      'academic_sessions',
      'sections',
      'fee_rates',
      'users',
      'auth_sessions',
      'students',
      'receipts',
    ]) {
      expect(await count(table), table).toBe(0);
    }
    expect(await count('classes')).toBe(15); // classes are fixed and stay
    // with no login left, the app offers only to finish the restore; still no sign-up
    const boot = (await new Client().get('/bootstrap')).data;
    expect(boot.needs_setup).toBe(true);
    expect(boot.user).toBeNull();
    expect((await new Client().post('/restore/begin')).status).toBe(200);
    expect([401, 404]).toContain((await new Client().post('/setup', {})).status);
  });
});
