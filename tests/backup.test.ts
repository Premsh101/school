import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { Client, OWNER, sectionId, setupSchool, signIn } from './helpers';

describe('backup and restore', () => {
  it('downloads everything and restores it into an empty database', async () => {
    const owner = await setupSchool();
    await owner.post('/students', {
      name: 'Backup Kid',
      admission_no: 'B-1',
      session_id: 1,
      enrolment: { branch_id: 1, class_id: 5, section_id: await sectionId(1, 5), roll_no: 7 },
    });
    await owner.post('/staff', { name: 'Clerk', branch_id: 1 });
    await owner.put('/settings', { school_name: 'Backup School' });

    // download, the way the browser does it
    const manifest = (await owner.get('/backup')).data;
    expect(manifest.format).toBe('school-app-backup');
    const backup: Record<string, unknown[]> = {};
    for (const t of manifest.tables) {
      const rows: unknown[] = [];
      let after: number | null = 0;
      while (after !== null) {
        const page: { rows: unknown[]; next: number | null } = (
          await owner.get(`/backup/${t.name}?after=${after}`)
        ).data;
        rows.push(...page.rows);
        after = page.next;
      }
      expect(rows).toHaveLength(t.rows);
      backup[t.name] = rows;
    }
    expect(backup.students).toHaveLength(1);
    expect((await owner.get('/backup/sqlite_master')).status).toBe(400);

    // restore is refused while the database has data
    expect((await new Client().post('/restore/begin')).status).toBe(403);

    // wipe (children first), as if this were a brand-new database
    await env.DB.batch([
      env.DB.prepare('DELETE FROM auth_sessions'),
      env.DB.prepare('DELETE FROM login_attempts'),
    ]);
    for (const t of [...manifest.tables].reverse()) {
      if (t.name !== 'classes') await env.DB.prepare(`DELETE FROM ${t.name}`).run();
    }

    const anon = new Client();
    expect((await anon.get('/bootstrap')).data.needs_setup).toBe(true);
    expect(
      (await anon.post('/restore/chunk', { token: 'guess', table: 'users', rows: [{ id: 1 }] }))
        .status,
    ).toBe(403);
    const begin = (await anon.post('/restore/begin')).data;
    for (const name of begin.tables) {
      const res = await anon.post('/restore/chunk', {
        token: begin.token,
        table: name,
        rows: backup[name],
      });
      expect(res.status, JSON.stringify(res.data)).toBe(200);
    }
    expect((await anon.post('/restore/finish', { token: begin.token })).status).toBe(200);
    // the token stops working once the restore is finished
    expect(
      (
        await anon.post('/restore/chunk', {
          token: begin.token,
          table: 'settings',
          rows: [{ key: 'x', value: 'y' }],
        })
      ).status,
    ).toBe(403);

    const back = await signIn(OWNER.username, OWNER.password);
    const boot = (await back.get('/bootstrap')).data;
    expect(boot.school.name).toBe('Backup School');
    const list = (await back.get('/students?session_id=1')).data.rows;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: 'Backup Kid',
      admission_no: 'B-1',
      roll_no: 7,
      class_id: 5,
    });
    expect((await back.get('/staff')).data).toHaveLength(1);
  });
});
