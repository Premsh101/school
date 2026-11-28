import { isValidDate, todayIST } from '../../../shared/dates';
import { CHARGE_LABELS, monthsStarted, PAYMENT_MODES, type ChargeType } from '../../../shared/fees';
import { REPORTS, type ReportColumn, type ReportResult } from '../../../shared/fees-api';
import { assertBranch, scopeSql } from '../../core/auth';
import { AppError, notFound } from '../../core/errors';
import type { Ctx } from '../../env';
import { lateFeesFor, positionSql, STUDENT_JOINS } from './service';

const LIMIT = 3000;
const col = (key: string, label: string, kind: ReportColumn['kind'] = 'text'): ReportColumn => ({
  key,
  label,
  kind,
});
const CLASS_LABEL = `cl.name || ' ' || sec.name`;

/**
 * Runs one report. Every report is limited to the user's branches and returns plain rows;
 * the browser turns them into a table, a CSV file or a printed page.
 */
export async function runReport(
  c: Ctx,
  name: string,
  q: Record<string, string>,
): Promise<ReportResult> {
  const report = REPORTS.find((r) => r.id === name);
  if (!report) throw notFound('Report');
  const db = c.env.DB;
  const user = c.get('user');
  const sessionId = Number(q.session_id) || 0;
  const session = await db
    .prepare('SELECT name, start_year, start_month FROM academic_sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ name: string; start_year: number; start_month: number }>();
  if (!session) throw notFound('Session');
  const today = todayIST();
  const branchId = Number(q.branch_id) || null;
  if (branchId) assertBranch(user, branchId);
  const classId = Number(q.class_id) || null;
  const sectionId = Number(q.section_id) || null;
  const from =
    q.from && isValidDate(q.from)
      ? q.from
      : `${session.start_year}-${String(session.start_month).padStart(2, '0')}-01`;
  const to = q.to && isValidDate(q.to) ? q.to : today;
  if (from > to) throw new AppError(400, 'The "from" date is after the "to" date. Swap them.');
  // Reports that are not about dates (pending, register, ...) look at everything unless a
  // period is chosen; then they also show what each student or class paid in that period.
  const hasRange = Boolean((q.from && isValidDate(q.from)) || (q.to && isValidDate(q.to)));
  // The dates were checked above (YYYY-MM-DD), so they are safe to write into the query.
  const collectedIn = `(SELECT COALESCE(SUM(rr.amount), 0) FROM receipts rr WHERE rr.enrolment_id = e.id AND rr.cancelled_at IS NULL AND rr.date BETWEEN '${from}' AND '${to}')`;
  const collectedColumn = col('collected', 'Collected in period', 'money');
  const mode = PAYMENT_MODES.find((m) => m === q.mode) ?? null;
  const pos = positionSql(monthsStarted(session, today));

  // Filters for student-based reports (aliases e, s, sec, cl, f) and receipt-based ones (alias r).
  const studentWhere = `WHERE e.session_id = ?1 AND (?2 IS NULL OR e.branch_id = ?2) AND (?3 IS NULL OR e.class_id = ?3) AND (?4 IS NULL OR e.section_id = ?4) ${scopeSql(user, 'e.branch_id')}`;
  const studentArgs = [sessionId, branchId, classId, sectionId];
  const receiptWhere = `WHERE r.session_id = ?1 AND (?2 IS NULL OR r.branch_id = ?2) AND r.date BETWEEN ?3 AND ?4 ${scopeSql(user, 'r.branch_id')}`;
  const receiptArgs = [sessionId, branchId, from, to];
  const receiptJoins = `FROM receipts r JOIN students s ON s.id = r.student_id JOIN enrolments e ON e.id = r.enrolment_id
    JOIN classes cl ON cl.id = e.class_id JOIN sections sec ON sec.id = e.section_id JOIN branches b ON b.id = r.branch_id`;
  const sums = `COUNT(*) AS students, SUM(${pos.fee}) AS fee, SUM(${pos.discount}) AS discount, SUM(${pos.net}) AS net, SUM(${pos.paid}) AS paid,
    SUM(${pos.counter_discount}) AS counter_discount, SUM(${pos.pending}) AS pending, SUM(${pos.overdue}) AS overdue`;
  const sumColumns = [
    col('students', 'Students', 'number'),
    col('fee', 'Fee', 'money'),
    col('discount', 'Discount', 'money'),
    col('net', 'To pay', 'money'),
    col('paid', 'Paid', 'money'),
    col('counter_discount', 'Counter discount', 'money'),
    col('pending', 'Pending', 'money'),
    col('overdue', 'Overdue today', 'money'),
  ];
  const modeSums = PAYMENT_MODES.map(
    (m) => `SUM(CASE WHEN r.mode = '${m}' THEN r.amount ELSE 0 END) AS ${m}`,
  ).join(', ');
  const modeColumns = [
    col('cash', 'Cash', 'money'),
    col('upi', 'UPI', 'money'),
    col('bank', 'Bank', 'money'),
    col('cheque', 'Cheque', 'money'),
    col('total', 'Total', 'money'),
  ];

  let columns: ReportColumn[];
  let sql: string;
  let args: unknown[];
  let subtitle = session.name;
  // Reports that add each student's late fee after the query (it needs their receipts).
  let withLateFee = false;
  switch (report.id) {
    case 'collection':
      subtitle = `${from} to ${to}`;
      columns = [
        col('date', 'Date', 'date'),
        col('receipt_no', 'Receipt no'),
        col('name', 'Student'),
        col('father_name', 'Father'),
        col('class', 'Class'),
        col('branch', 'School'),
        col('mode', 'Mode'),
        col('reference', 'Reference'),
        col('amount', 'Amount', 'money'),
        col('late_fee', 'Of which late fee', 'money'),
        col('counter_discount', 'Discount', 'money'),
        col('collected_by', 'Collected by'),
      ];
      sql = `SELECT r.date, r.receipt_no, s.name, s.father_name, ${CLASS_LABEL} AS class, b.name AS branch, r.mode, r.reference, r.amount, r.late_fee, r.counter_discount, r.collected_by_name AS collected_by
             ${receiptJoins} ${receiptWhere} AND r.cancelled_at IS NULL AND (?5 IS NULL OR e.class_id = ?5) AND (?6 IS NULL OR r.mode = ?6) ORDER BY r.date, r.id`;
      args = [...receiptArgs, classId, mode];
      break;
    case 'daywise':
      subtitle = `${from} to ${to}`;
      columns = [
        col('date', 'Date', 'date'),
        col('receipts', 'Receipts', 'number'),
        ...modeColumns,
      ];
      sql = `SELECT r.date, COUNT(*) AS receipts, ${modeSums}, SUM(r.amount) AS total FROM receipts r ${receiptWhere} AND r.cancelled_at IS NULL GROUP BY r.date ORDER BY r.date`;
      args = receiptArgs;
      break;
    case 'staff':
      subtitle = `${from} to ${to}`;
      columns = [
        col('collected_by', 'Collected by'),
        col('receipts', 'Receipts', 'number'),
        ...modeColumns,
      ];
      sql = `SELECT r.collected_by_name AS collected_by, COUNT(*) AS receipts, ${modeSums}, SUM(r.amount) AS total FROM receipts r ${receiptWhere} AND r.cancelled_at IS NULL GROUP BY r.collected_by_name ORDER BY total DESC`;
      args = receiptArgs;
      break;
    case 'cancelled':
      subtitle = `${from} to ${to}`;
      columns = [
        col('date', 'Date', 'date'),
        col('receipt_no', 'Receipt no'),
        col('name', 'Student'),
        col('class', 'Class'),
        col('amount', 'Amount', 'money'),
        col('mode', 'Mode'),
        col('collected_by', 'Collected by'),
        col('cancelled_on', 'Cancelled on', 'date'),
        col('cancelled_by', 'Cancelled by'),
        col('reason', 'Reason'),
      ];
      sql = `SELECT r.date, r.receipt_no, s.name, ${CLASS_LABEL} AS class, r.amount, r.mode, r.collected_by_name AS collected_by,
                    substr(r.cancelled_at, 1, 10) AS cancelled_on, r.cancelled_by_name AS cancelled_by, r.cancel_reason AS reason
             ${receiptJoins} ${receiptWhere} AND r.cancelled_at IS NOT NULL ORDER BY r.date, r.id`;
      args = receiptArgs;
      break;
    case 'pending': {
      const wholeYear = q.basis === 'year';
      const amount = wholeYear ? pos.pending : pos.overdue;
      const min = Math.max(1, Math.trunc(Number(q.min)) || 1);
      subtitle = `${session.name}, ${wholeYear ? 'pending for the whole year' : 'due as of today'}`;
      columns = [
        col('name', 'Student'),
        col('father_name', 'Father'),
        col('class', 'Class'),
        col('roll_no', 'Roll', 'number'),
        col('phone', 'Phone'),
        col('phone2', 'Phone 2'),
        col('amount', wholeYear ? 'Pending' : 'Due today', 'money'),
        col('late_fee', 'Late fee', 'money'),
        col('paid', 'Paid so far', 'money'),
        ...(hasRange ? [collectedColumn] : []),
      ];
      withLateFee = true;
      sql = `SELECT e.id AS enrolment_id, s.name, s.father_name, ${CLASS_LABEL} AS class, e.roll_no, s.phone, s.phone2, ${amount} AS amount, ${pos.paid} AS paid${hasRange ? `, ${collectedIn} AS collected` : ''}
             ${STUDENT_JOINS} ${studentWhere} AND ${amount} >= ?5 ORDER BY cl.sort_order, sec.name, amount DESC`;
      args = [...studentArgs, min];
      break;
    }
    case 'classpending':
      // Every student who is studying, whether or not they owe anything.
      subtitle = `${session.name}, as of today`;
      columns = [
        col('class', 'Class'),
        col('roll_no', 'Roll', 'number'),
        col('name', 'Student'),
        col('father_name', 'Father'),
        col('phone', 'Phone'),
        col('phone2', 'Phone 2'),
        col('net', 'To pay', 'money'),
        col('paid', 'Paid', 'money'),
        col('overdue', 'Due today', 'money'),
        col('pending', 'Pending for the year', 'money'),
        col('late_fee', 'Late fee', 'money'),
        ...(hasRange ? [collectedColumn] : []),
      ];
      withLateFee = true;
      sql = `SELECT e.id AS enrolment_id, ${CLASS_LABEL} AS class, e.roll_no, s.name, s.father_name, s.phone, s.phone2,
                    ${pos.net} AS net, ${pos.paid} AS paid, ${pos.overdue} AS overdue, ${pos.pending} AS pending${hasRange ? `, ${collectedIn} AS collected` : ''}
             ${STUDENT_JOINS} ${studentWhere} AND e.status = 'studying'
             ORDER BY cl.sort_order, sec.name, e.roll_no IS NULL, e.roll_no, s.name`;
      args = studentArgs;
      break;
    case 'register':
      columns = [
        col('admission_no', 'Adm. no'),
        col('name', 'Student'),
        col('father_name', 'Father'),
        col('class', 'Class'),
        col('roll_no', 'Roll', 'number'),
        col('type', 'New/old'),
        col('status', 'Status'),
        col('fee', 'Fee', 'money'),
        col('discount', 'Discount', 'money'),
        col('net', 'To pay', 'money'),
        col('paid', 'Paid', 'money'),
        col('counter_discount', 'Counter discount', 'money'),
        col('pending', 'Pending', 'money'),
        col('overdue', 'Overdue today', 'money'),
        ...(hasRange ? [collectedColumn] : []),
      ];
      sql = `SELECT s.admission_no, s.name, s.father_name, ${CLASS_LABEL} AS class, e.roll_no, e.admission_type AS type, e.status,
                    ${pos.fee} AS fee, ${pos.discount} AS discount, ${pos.net} AS net, ${pos.paid} AS paid, ${pos.counter_discount} AS counter_discount, ${pos.pending} AS pending, ${pos.overdue} AS overdue${hasRange ? `, ${collectedIn} AS collected` : ''}
             ${STUDENT_JOINS} ${studentWhere} ORDER BY cl.sort_order, sec.name, e.roll_no IS NULL, e.roll_no, s.name`;
      args = studentArgs;
      break;
    case 'classwise':
      columns = [col('class', 'Class'), ...sumColumns, ...(hasRange ? [collectedColumn] : [])];
      sql = `SELECT cl.name AS class, ${sums}${hasRange ? `, SUM(${collectedIn}) AS collected` : ''} ${STUDENT_JOINS} ${studentWhere} GROUP BY cl.id ORDER BY cl.sort_order`;
      args = studentArgs;
      break;
    case 'branchwise':
      columns = [col('branch', 'School'), ...sumColumns, ...(hasRange ? [collectedColumn] : [])];
      sql = `SELECT b.name AS branch, ${sums}${hasRange ? `, SUM(${collectedIn}) AS collected` : ''} ${STUDENT_JOINS} JOIN branches b ON b.id = e.branch_id ${studentWhere} GROUP BY b.id ORDER BY b.id`;
      args = studentArgs;
      break;
    case 'discounts': {
      // One line per fee type discounted for a student, then the counter discounts.
      const labels = Object.entries(CHARGE_LABELS)
        .map(([type, label]) => `WHEN '${type as ChargeType}' THEN '${label}'`)
        .join(' ');
      columns = [
        col('name', 'Student'),
        col('class', 'Class'),
        col('fee_type', 'Discount on'),
        col('given_as', 'Given as'),
        col('discount', 'Discount for the year', 'money'),
        col('reason', 'Reason'),
      ];
      sql = `SELECT s.name, ${CLASS_LABEL} AS class, CASE j.value->>'type' ${labels} END AS fee_type,
                    CASE j.value->>'discount_type' WHEN 'percent' THEN (j.value->>'discount_value') || '%' ELSE '₹' || (j.value->>'discount_value') END
                      || CASE WHEN j.value->>'type' = 'monthly' THEN ' every month' ELSE '' END AS given_as,
                    (j.value->>'discount') * CASE WHEN j.value->>'type' = 'monthly' THEN f.months ELSE 1 END AS discount,
                    f.discount_reason AS reason, cl.sort_order AS o1, sec.name AS o2, s.name AS o3
               ${STUDENT_JOINS} JOIN json_each(f.items) j ${studentWhere} AND j.value->>'discount' > 0${
                 hasRange
                   ? ` AND date(f.updated_at, '+330 minutes') BETWEEN '${from}' AND '${to}'`
                   : ''
               }
             UNION ALL
             SELECT s.name, ${CLASS_LABEL}, 'Counter discount', 'Receipt ' || r.receipt_no || ' on ' || r.date, r.counter_discount, r.note, cl.sort_order, sec.name, s.name
               FROM receipts r JOIN enrolments e ON e.id = r.enrolment_id JOIN students s ON s.id = e.student_id
               JOIN classes cl ON cl.id = e.class_id JOIN sections sec ON sec.id = e.section_id
               ${studentWhere} AND r.cancelled_at IS NULL AND r.counter_discount > 0${
                 hasRange ? ` AND r.date BETWEEN '${from}' AND '${to}'` : ''
               }
             ORDER BY o1, o2, o3`;
      args = studentArgs;
      break;
    }
  }
  if (hasRange && !['collection', 'daywise', 'staff', 'cancelled'].includes(report.id))
    subtitle += `, ${from} to ${to}`;
  const { results } = await db
    .prepare(`${sql} LIMIT ${LIMIT + 1}`)
    .bind(...args)
    .all<Record<string, string | number | null>>();
  if (withLateFee) {
    const late = await lateFeesFor(
      db,
      results.map((row) => Number(row.enrolment_id)),
      today,
    );
    for (const row of results) row.late_fee = late.get(Number(row.enrolment_id))?.outstanding ?? 0;
  }
  const keys = columns.map((cn) => cn.key);
  return {
    title: `${report.name} · ${subtitle}`,
    columns,
    rows: results
      .slice(0, LIMIT)
      .map((row) => Object.fromEntries(keys.map((k) => [k, row[k] ?? null]))),
    truncated: results.length > LIMIT,
  };
}
