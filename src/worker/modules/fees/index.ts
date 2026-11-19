import { Hono } from 'hono';
import { z } from 'zod';
import { DEFAULT_RATE_CHART, FEE_KEYS, type FeeRate } from '../../../shared/fees';
import { audit } from '../../core/audit';
import { requirePermission } from '../../core/auth';
import { AppError, notFound, parse } from '../../core/errors';
import type { AppEnv } from '../../env';
import type { WorkerModule } from '../index';

const routes = new Hono<AppEnv>();
const COLUMNS = FEE_KEYS.join(', ');

const rupees = z
  .number()
  .int('Use whole rupees, no paise')
  .min(0, 'Amount cannot be less than 0')
  .max(1_000_000, 'Amount is too large');
const amounts = z.object({
  registration: rupees,
  admission: rupees,
  board: rupees,
  annual: rupees,
  practical: rupees,
  practical_alt: rupees,
  tbdb: rupees,
  monthly: rupees,
});
const ratesInput = z.object({
  session_id: z.number().int().positive(),
  class_ids: z.array(z.number().int().positive()).min(1, 'Choose at least one class').max(30),
  new: amounts,
  old: amounts,
});

/** The default chart as one JSON list, unpacked in SQL against the classes table. */
const defaultsJson = JSON.stringify(
  DEFAULT_RATE_CHART.flatMap((g) =>
    (['new', 'old'] as const).map((type) => ({
      from_order: g.from_order,
      to_order: g.to_order,
      admission_type: type,
      ...g[type],
    })),
  ),
);

/**
 * Fills the chart of a session that has none: copies the newest earlier session that has
 * a chart, or uses the printed 2026-27 chart when there is nothing to copy.
 * `sessionSql` is a SQL expression giving the target session id.
 */
function fillStatements(
  db: D1Database,
  sessionSql: string,
  params: unknown[],
): D1PreparedStatement[] {
  const now = new Date().toISOString();
  const empty = `NOT EXISTS (SELECT 1 FROM fee_rates WHERE session_id = ${sessionSql})`;
  return [
    db
      .prepare(
        `INSERT INTO fee_rates (session_id, class_id, admission_type, ${COLUMNS}, updated_at)
         SELECT ${sessionSql}, class_id, admission_type, ${COLUMNS}, ?
           FROM fee_rates
          WHERE session_id = (
                  SELECT s.id FROM academic_sessions s
                   WHERE s.start_year < (SELECT start_year FROM academic_sessions WHERE id = ${sessionSql})
                     AND EXISTS (SELECT 1 FROM fee_rates f WHERE f.session_id = s.id)
                   ORDER BY s.start_year DESC LIMIT 1)
            AND ${empty}`,
      )
      .bind(...params, now, ...params, ...params),
    db
      .prepare(
        `INSERT INTO fee_rates (session_id, class_id, admission_type, ${COLUMNS}, updated_at)
         SELECT ${sessionSql}, c.id, j.value->>'admission_type', ${FEE_KEYS.map((k) => `j.value->>'${k}'`).join(', ')}, ?
           FROM json_each(?) j JOIN classes c ON c.sort_order BETWEEN j.value->>'from_order' AND j.value->>'to_order'
          WHERE ${empty}`,
      )
      .bind(...params, now, defaultsJson, ...params),
  ];
}

routes.get('/rates', requirePermission('fees.view'), async (c) => {
  const sessionId = Number(c.req.query('session_id')) || 0;
  const { results } = await c.env.DB.prepare(
    `SELECT class_id, admission_type, ${COLUMNS} FROM fee_rates WHERE session_id = ?`,
  )
    .bind(sessionId)
    .all<FeeRate>();
  return c.json(results);
});

/** Sets the same fees for one or more classes of a session (new and old students). */
routes.put('/rates', requirePermission('fees.rates.edit'), async (c) => {
  const db = c.env.DB;
  const input = parse(ratesInput, await c.req.json());
  const [session, classes] = await db.batch([
    db.prepare('SELECT name FROM academic_sessions WHERE id = ?').bind(input.session_id),
    db
      .prepare(
        'SELECT id, name FROM classes WHERE id IN (SELECT value FROM json_each(?)) ORDER BY sort_order',
      )
      .bind(JSON.stringify(input.class_ids)),
  ]);
  const sessionRow = session!.results[0] as { name: string } | undefined;
  const classRows = classes!.results as { id: number; name: string }[];
  if (!sessionRow) throw notFound('Session');
  if (classRows.length !== new Set(input.class_ids).size)
    throw new AppError(
      400,
      'One of the chosen classes does not exist. Reload the page and try again.',
    );
  for (const type of ['new', 'old'] as const) {
    const a = input[type];
    if (a.practical_alt > 0 && a.practical_alt <= a.practical) {
      throw new AppError(
        400,
        'The higher practical option must be more than the normal practical fee, or 0 if there is no second option.',
        { [`${type}.practical_alt`]: 'Must be more than practical' },
      );
    }
  }
  const now = new Date().toISOString();
  const rows = classRows.flatMap((cls) =>
    (['new', 'old'] as const).map((type) => ({
      class_id: cls.id,
      admission_type: type,
      ...input[type],
    })),
  );
  await db.batch([
    db
      .prepare(
        `INSERT INTO fee_rates (session_id, class_id, admission_type, ${COLUMNS}, updated_at)
         SELECT ?1, j.value->>'class_id', j.value->>'admission_type', ${FEE_KEYS.map((k) => `j.value->>'${k}'`).join(', ')}, ?2
           FROM json_each(?3) j WHERE true
         ON CONFLICT (session_id, class_id, admission_type) DO UPDATE SET
           ${FEE_KEYS.map((k) => `${k} = excluded.${k}`).join(', ')}, updated_at = excluded.updated_at`,
      )
      .bind(input.session_id, now, JSON.stringify(rows)),
    audit(c, {
      action: 'update',
      entity: 'fee_rates',
      summary: `Changed the fee rate chart of ${sessionRow.name} for ${classRows.map((cls) => cls.name).join(', ')}`,
      details: { new: input.new, old: input.old },
    }),
  ]);
  return c.json({ ok: true });
});

/** For a session with no chart yet: copy the previous session's chart, or the printed one. */
routes.post('/rates/start', requirePermission('fees.rates.edit'), async (c) => {
  const db = c.env.DB;
  const body = parse(z.object({ session_id: z.number().int().positive() }), await c.req.json());
  const session = await db
    .prepare('SELECT name FROM academic_sessions WHERE id = ?')
    .bind(body.session_id)
    .first<{ name: string }>();
  if (!session) throw notFound('Session');
  await db.batch([
    ...fillStatements(db, '?', [body.session_id]),
    audit(c, {
      action: 'create',
      entity: 'fee_rates',
      summary: `Started the fee rate chart of ${session.name}`,
    }),
  ]);
  return c.json({ ok: true });
});

export const feesModule: WorkerModule = {
  id: 'fees',
  name: 'Fees',
  routes,
  permissions: ['fees.view', 'fees.rates.edit'],
  // Admin has every permission. Editing the chart stays with the admin.
  rolePermissions: { principal: ['fees.view'], accountant: ['fees.view'] },
  backupTables: ['fee_rates'],
  // A new session starts with the previous session's chart (or the printed one).
  onSessionOpened: (c, _from, to) =>
    fillStatements(c.env.DB, '(SELECT id FROM academic_sessions WHERE start_year = ?)', [
      to.start_year,
    ]),
};
