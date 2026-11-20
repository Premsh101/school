// Reads the Demo School's fees and receipts from a local database built by seed/demo/build.sh
// and writes migrations/0006_initial_school_demo.sql. Every reference to another row is written
// as a lookup by a natural key (admission number, school code, session name), so the file loads
// into any database whatever ids it already uses.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const persist = process.argv[2];
if (!persist) throw new Error('usage: node seed/demo/export.mjs <persist-dir>');

function rows(sql) {
  const out = execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'DB',
      '--local',
      '--persist-to',
      persist,
      '--json',
      '--command',
      sql,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(out)[0].results;
}

const q = (v) =>
  v === null || v === undefined
    ? 'NULL'
    : typeof v === 'number'
      ? String(v)
      : `'${String(v).replace(/'/g, "''")}'`;
const DEMO = "(SELECT id FROM branches WHERE code = 'DEMO')";
const SESSION = "(SELECT id FROM academic_sessions WHERE name = '2026-27')";
const GUARD = "WHERE EXISTS (SELECT 1 FROM settings WHERE key = 'demo.loading')";
const student = (adm) => `(SELECT id FROM students WHERE admission_no = ${q(adm)})`;
const enrolment = (adm) =>
  `(SELECT id FROM enrolments WHERE student_id = ${student(adm)} AND session_id = ${SESSION})`;
const ADMIN = "(SELECT id FROM users WHERE username = 'admin@sps.com')";

const fees = rows(`SELECT s.admission_no, f.* FROM student_fees f
  JOIN enrolments e ON e.id = f.enrolment_id JOIN students s ON s.id = e.student_id
  JOIN branches b ON b.id = e.branch_id WHERE b.code = 'DEMO' ORDER BY s.admission_no`);
const receipts = rows(`SELECT s.admission_no, r.* FROM receipts r
  JOIN students s ON s.id = r.student_id JOIN branches b ON b.id = r.branch_id
  WHERE b.code = 'DEMO' ORDER BY r.seq`);

const sql = [readFileSync(new URL('./header.sql', import.meta.url), 'utf8').trim(), ''];
sql.push('-- Students, their classes and the staff.');
sql.push(readFileSync(new URL('./.students.sql', import.meta.url), 'utf8').trim(), '');

sql.push("-- Each student's fees, with discounts and what has been paid.");
for (const f of fees) {
  sql.push(
    `INSERT INTO student_fees (enrolment_id, months, items, one_time_gross, one_time_net, monthly_gross, monthly_net, discount_reason, paid, counter_discount, updated_at)
SELECT ${enrolment(f.admission_no)}, ${[f.months, f.items, f.one_time_gross, f.one_time_net, f.monthly_gross, f.monthly_net, f.discount_reason, f.paid, f.counter_discount, f.updated_at].map(q).join(', ')} ${GUARD};`,
  );
}
sql.push('', '-- Receipts from April to November 2026, two of them cancelled.');
for (const r of receipts) {
  sql.push(
    `INSERT INTO receipts (receipt_no, branch_id, seq, enrolment_id, student_id, session_id, date, amount, counter_discount, counter_discount_type, counter_discount_value, mode, reference, note, collected_by, collected_by_name, created_at, cancelled_at, cancelled_by_name, cancel_reason)
SELECT ${q(r.receipt_no)}, ${DEMO}, ${r.seq}, ${enrolment(r.admission_no)}, ${student(r.admission_no)}, ${SESSION}, ${[r.date, r.amount, r.counter_discount, r.counter_discount_type, r.counter_discount_value, r.mode, r.reference, r.note].map(q).join(', ')}, ${ADMIN}, 'Admin', ${[r.created_at, r.cancelled_at, r.cancelled_by_name, r.cancel_reason].map(q).join(', ')} ${GUARD};`,
  );
}
sql.push('', "DELETE FROM settings WHERE key = 'demo.loading';", '');

const out = new URL('../../migrations/0006_initial_school_demo.sql', import.meta.url);
writeFileSync(out, sql.join('\n'));
console.log(
  `Wrote migrations/0006_initial_school_demo.sql: ${fees.length} fee plans, ${receipts.length} receipts.`,
);
