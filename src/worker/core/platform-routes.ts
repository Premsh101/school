import { Hono } from 'hono';
import type { AuditRow, Paged } from '../../shared/types';
import type { AppEnv } from '../env';
import { modules } from '../modules';
import { audit } from './audit';
import { requirePermission } from './auth';
import { AppError } from './errors';
import { newToken } from './password';

/** Core tables in the order they must be restored (parents before children). */
const CORE_TABLES = [
  'branches',
  'academic_sessions',
  'classes',
  'sections',
  'subjects',
  'users',
  'user_branches',
  'students',
  'enrolments',
  'staff',
  'settings',
  'audit_log',
];
export const backupTables = () => [...CORE_TABLES, ...modules.flatMap((m) => m.backupTables)];
export const BACKUP_FORMAT = 'school-app-backup';
export const BACKUP_VERSION = 1;
const CHUNK = 500;
const RESTORE_TOKEN_MINUTES = 60;

function assertTable(name: string): string {
  if (!backupTables().includes(name))
    throw new AppError(400, `"${name}" is not a table in this app.`);
  return name;
}

// ── Signed-in routes: audit log and backup download ─────────────────────────

export const platformRoutes = new Hono<AppEnv>();

platformRoutes.get('/audit', requirePermission('audit.view'), async (c) => {
  const db = c.env.DB;
  const page = Math.max(1, Number(c.req.query('page')) || 1);
  const size = 50;
  const [rows, count] = await db.batch([
    db
      .prepare(
        'SELECT id, at, user_name, action, entity, entity_id, branch_id, summary FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?',
      )
      .bind(size, (page - 1) * size),
    db.prepare('SELECT COUNT(*) AS n FROM audit_log'),
  ]);
  return c.json<Paged<AuditRow>>({
    rows: rows!.results as AuditRow[],
    page,
    page_size: size,
    total: (count!.results[0] as { n: number }).n,
  });
});

/** Table names and row counts, so the browser can download the backup piece by piece. */
platformRoutes.get('/backup', requirePermission('backup.manage'), async (c) => {
  const db = c.env.DB;
  const tables = backupTables();
  const [, ...counts] = await db.batch([
    audit(c, { action: 'export', entity: 'backup', summary: 'Downloaded a backup' }),
    ...tables.map((t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`)),
  ]);
  return c.json({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    tables: tables.map((name, i) => ({ name, rows: (counts[i]!.results[0] as { n: number }).n })),
  });
});

/** One page of a table. Small pages keep each request far inside the free CPU limit. */
platformRoutes.get('/backup/:table', requirePermission('backup.manage'), async (c) => {
  const table = assertTable(c.req.param('table'));
  const after = Number(c.req.query('after')) || 0;
  const { results } = await c.env.DB.prepare(
    `SELECT rowid AS _rowid, * FROM ${table} WHERE rowid > ? ${table === 'settings' ? "AND key NOT LIKE 'restore_token%'" : ''} ORDER BY rowid LIMIT ${CHUNK}`,
  )
    .bind(after)
    .all<Record<string, unknown>>();
  const next = results.length === CHUNK ? (results[results.length - 1]!._rowid as number) : null;
  return c.json({ rows: results.map(({ _rowid, ...row }) => (void _rowid, row)), next });
});

// ── Restore: only into an empty database (no users yet), so it needs no sign-in ──

export const restoreRoutes = new Hono<AppEnv>();

restoreRoutes.post('/restore/begin', async (c) => {
  const db = c.env.DB;
  const users = await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  if (users!.n > 0) {
    throw new AppError(
      403,
      'A backup can only be restored into an empty database. This one already has data.',
    );
  }
  const token = newToken();
  // The school loaded with the app (branches, session, fee chart) is cleared first, so the
  // backup replaces it completely instead of mixing with it. Nothing else can be in the
  // database yet: there is no login.
  const keep = ['classes', 'audit_log'];
  const clear = [...backupTables()].reverse().filter((t) => !keep.includes(t));
  await db.batch([
    ...clear.map((t) => db.prepare(`DELETE FROM ${t}`)),
    db
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('restore_token', ?)")
      .bind(token),
    db
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('restore_token_at', ?)")
      .bind(String(Date.now())),
  ]);
  return c.json({ token, tables: backupTables() });
});

async function assertRestoreToken(db: D1Database, token: unknown): Promise<void> {
  const { results } = await db
    .prepare("SELECT key, value FROM settings WHERE key LIKE 'restore_token%'")
    .all<{ key: string; value: string }>();
  const map = Object.fromEntries(results.map((r) => [r.key, r.value]));
  const fresh = Date.now() - Number(map.restore_token_at ?? 0) < RESTORE_TOKEN_MINUTES * 60_000;
  if (typeof token !== 'string' || !map.restore_token || map.restore_token !== token || !fresh) {
    throw new AppError(
      403,
      'The restore has timed out or was not started. Start the restore again.',
    );
  }
}

restoreRoutes.post('/restore/chunk', async (c) => {
  const db = c.env.DB;
  const body = (await c.req.json()) as {
    token?: string;
    table?: string;
    rows?: Record<string, unknown>[];
  };
  await assertRestoreToken(db, body.token);
  const table = assertTable(String(body.table));
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) return c.json({ ok: true });
  if (rows.length > CHUNK) throw new AppError(400, 'Too many rows in one piece.');
  const columns = Object.keys(rows[0]!);
  if (columns.length === 0 || columns.some((col) => !/^[a-z][a-z0-9_]*$/.test(col))) {
    throw new AppError(
      400,
      `The backup file has a column this app does not understand in "${table}".`,
    );
  }
  const clean =
    table === 'settings' ? rows.filter((r) => !String(r.key).startsWith('restore_token')) : rows;
  try {
    await db
      .prepare(
        `INSERT OR REPLACE INTO ${table} (${columns.join(', ')})
         SELECT ${columns.map((col) => `j.value->>'${col}'`).join(', ')} FROM json_each(?) j`,
      )
      .bind(JSON.stringify(clean))
      .run();
  } catch (e) {
    throw new AppError(
      400,
      `Could not restore "${table}": ${e instanceof Error ? e.message : 'unknown error'}. Check that the file is a backup from this app.`,
    );
  }
  return c.json({ ok: true });
});

restoreRoutes.post('/restore/finish', async (c) => {
  const db = c.env.DB;
  const body = (await c.req.json()) as { token?: string };
  await assertRestoreToken(db, body.token);
  await db.batch([
    db.prepare("DELETE FROM settings WHERE key LIKE 'restore_token%'"),
    db.prepare('DELETE FROM auth_sessions'),
    db
      .prepare(
        `INSERT INTO audit_log (at, user_name, action, entity, summary) VALUES (?, 'System', 'restore', 'backup', 'Restored from a backup file')`,
      )
      .bind(new Date().toISOString()),
  ]);
  return c.json({ ok: true });
});
