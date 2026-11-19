import { DEFAULT_RATE_CHART, FEE_KEYS, ONE_TIME_TYPES } from '../../../shared/fees';

// SQL building blocks shared by the fees routes and reports.

export const RATE_COLUMNS = FEE_KEYS.join(', ');

/** The printed chart as one JSON list, unpacked in SQL against the classes table. */
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
 * Gives every branch a rate chart for one session, without touching charts that exist.
 * A missing chart is copied from the same branch's newest earlier session, else from
 * another branch in the same session, else from the printed 2026-27 chart.
 * `session` is a SQL expression for the session id that uses the bound value as ?1.
 */
export function ensureRates(db: D1Database, session: string, value: number): D1PreparedStatement[] {
  const now = new Date().toISOString();
  const missing = (branch: string) =>
    `NOT EXISTS (SELECT 1 FROM fee_rates x WHERE x.session_id = ${session} AND x.branch_id = ${branch})`;
  const insert = `INSERT INTO fee_rates (session_id, branch_id, class_id, admission_type, ${RATE_COLUMNS}, updated_at)`;
  const cols = FEE_KEYS.map((k) => `r.${k}`).join(', ');
  return [
    db
      .prepare(
        `${insert}
         SELECT ${session}, r.branch_id, r.class_id, r.admission_type, ${cols}, ?2
           FROM fee_rates r
          WHERE r.session_id = (
                  SELECT s.id FROM academic_sessions s
                   WHERE s.start_year < (SELECT start_year FROM academic_sessions WHERE id = ${session})
                     AND EXISTS (SELECT 1 FROM fee_rates f WHERE f.session_id = s.id AND f.branch_id = r.branch_id)
                   ORDER BY s.start_year DESC LIMIT 1)
            AND ${missing('r.branch_id')}`,
      )
      .bind(value, now),
    db
      .prepare(
        `${insert}
         SELECT ${session}, b.id, r.class_id, r.admission_type, ${cols}, ?2
           FROM branches b
           JOIN fee_rates r ON r.session_id = ${session}
            AND r.branch_id = (SELECT MIN(branch_id) FROM fee_rates WHERE session_id = ${session})
          WHERE ${missing('b.id')}`,
      )
      .bind(value, now),
    db
      .prepare(
        `${insert}
         SELECT ${session}, b.id, c.id, j.value->>'admission_type', ${FEE_KEYS.map((k) => `j.value->>'${k}'`).join(', ')}, ?2
           FROM branches b
           JOIN json_each(?3) j
           JOIN classes c ON c.sort_order BETWEEN j.value->>'from_order' AND j.value->>'to_order'
          WHERE ${session} IS NOT NULL AND ${missing('b.id')}`,
      )
      .bind(value, now, defaultsJson),
  ];
}

const item = (type: string) =>
  `json_object('type', '${type}', 'amount', r.${type}, 'discount_type', 'none', 'discount_value', 0, 'discount', 0)`;
const oneTimeSum = ONE_TIME_TYPES.map((t) => `r.${t}`).join(' + ');

/**
 * Copies fees from the rate chart to every student of a session who has none yet
 * (12 months, no discounts, the normal practical). Students who already have fees
 * are never changed.
 */
export function ensureStudentFees(
  db: D1Database,
  session: string,
  value: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO student_fees (enrolment_id, months, items, one_time_gross, one_time_net, monthly_gross, monthly_net, updated_at)
       SELECT e.id, 12, json_array(${[...ONE_TIME_TYPES, 'monthly'].map(item).join(', ')}),
              ${oneTimeSum}, ${oneTimeSum}, r.monthly, r.monthly, ?2
         FROM enrolments e
         JOIN fee_rates r ON r.session_id = e.session_id AND r.branch_id = e.branch_id
          AND r.class_id = e.class_id AND r.admission_type = e.admission_type
        WHERE e.session_id = ${session}
          AND NOT EXISTS (SELECT 1 FROM student_fees f WHERE f.enrolment_id = e.id)`,
    )
    .bind(value, new Date().toISOString());
}

/** Everything needed after enrolments are added to a session. */
export const afterEnrolments = (db: D1Database, sessionId: number): D1PreparedStatement[] => [
  ...ensureRates(db, '?1', sessionId),
  ensureStudentFees(db, '?1', sessionId),
];

/** Brings a student's paid and counter-discount totals in line with their receipts. */
export function refreshPaid(db: D1Database, enrolmentId: number): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE student_fees SET
         paid = (SELECT COALESCE(SUM(amount), 0) FROM receipts WHERE enrolment_id = ?1 AND cancelled_at IS NULL),
         counter_discount = (SELECT COALESCE(SUM(counter_discount), 0) FROM receipts WHERE enrolment_id = ?1 AND cancelled_at IS NULL)
       WHERE enrolment_id = ?1`,
    )
    .bind(enrolmentId);
}

// ── Fee position in SQL ─────────────────────────────────────────────────────
// The same rules as feePosition() in src/shared/fees.ts, written as SQL so thousands of
// students can be added up in one query. A test checks that the two always agree.
// Needs aliases e (enrolments) and f (student_fees, LEFT JOIN).

const settled = `(COALESCE(f.paid, 0) + COALESCE(f.counter_discount, 0))`;
const left = `e.status = 'left'`;

export function positionSql(monthsStarted: number) {
  const m = Math.max(0, Math.min(12, Math.trunc(monthsStarted)));
  const yearNet = `(COALESCE(f.one_time_net, 0) + COALESCE(f.monthly_net, 0) * COALESCE(f.months, 0))`;
  const net = `(CASE WHEN ${left} THEN ${settled} ELSE ${yearNet} END)`;
  const due = `(CASE WHEN ${left} THEN ${settled} ELSE COALESCE(f.one_time_net, 0) + COALESCE(f.monthly_net, 0) * MIN(COALESCE(f.months, 0), ${m}) END)`;
  const gross = `(COALESCE(f.one_time_gross, 0) + COALESCE(f.monthly_gross, 0) * COALESCE(f.months, 0))`;
  return {
    fee: gross,
    discount: `(${gross} - ${yearNet})`,
    net,
    paid: `COALESCE(f.paid, 0)`,
    counter_discount: `COALESCE(f.counter_discount, 0)`,
    settled,
    pending: `MAX(0, ${net} - ${settled})`,
    due_today: due,
    overdue: `MAX(0, ${due} - ${settled})`,
  };
}

export const STUDENT_JOINS = `FROM enrolments e
  JOIN students s ON s.id = e.student_id
  JOIN sections sec ON sec.id = e.section_id
  JOIN classes cl ON cl.id = e.class_id
  LEFT JOIN student_fees f ON f.enrolment_id = e.id`;
