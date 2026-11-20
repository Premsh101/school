import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, setupSchool } from './helpers';

const count = async (table: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_SEED);
});

describe('restoring a backup onto a database that came with the school', () => {
  it('clears the loaded school first, so the backup replaces it completely', async () => {
    const anon = new Client();
    expect((await anon.get('/bootstrap')).data.preset).not.toBeNull();
    const begin = await anon.post('/restore/begin');
    expect(begin.status).toBe(200);
    expect(await count('branches')).toBe(0);
    expect(await count('academic_sessions')).toBe(0);
    expect(await count('sections')).toBe(0);
    expect(await count('fee_rates')).toBe(0);
    expect(await count('classes')).toBe(15); // classes are fixed and stay
    const boot = (await anon.get('/bootstrap')).data;
    expect(boot.needs_setup).toBe(true);
    expect(boot.preset).toBeNull();
  });

  it('then the full first-time setup still works on the emptied database', async () => {
    const owner = await setupSchool();
    const boot = (await owner.get('/bootstrap')).data;
    expect(boot.branches.map((b: any) => b.code)).toEqual(['KMG']);
    expect(boot.sessions.map((s: any) => s.name)).toEqual(['2026-27']);
    expect((await owner.get('/fees/rates?session_id=1')).data).toHaveLength(30);
  });
});
