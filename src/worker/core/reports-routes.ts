import { Hono } from 'hono';
import { isValidDate } from '../../shared/dates';
import { CORE_REPORTS, type ReportColumn, type ReportResult } from '../../shared/reports';
import type { AppEnv } from '../env';
import { assertBranch, requirePermission, scopeSql } from './auth';
import { notFound } from './errors';

/** Reports about students. Fee reports live in the fees module. */
export const reportRoutes = new Hono<AppEnv>();

const LIMIT = 3000;
const col = (key: string, label: string, kind: ReportColumn['kind'] = 'text'): ReportColumn => ({
  key,
  label,
  kind,
});

reportRoutes.get('/reports/:name', requirePermission('students.view'), async (c) => {
  const report = CORE_REPORTS.find((r) => r.id === c.req.param('name'));
  if (!report) throw notFound('Report');
  const db = c.env.DB;
  const user = c.get('user');
  const q = c.req.query();
  const session = await db
    .prepare('SELECT id, name FROM academic_sessions WHERE id = ?')
    .bind(Number(q.session_id) || 0)
    .first<{ id: number; name: string }>();
  if (!session) throw notFound('Session');
  const branchId = Number(q.branch_id) || null;
  if (branchId) assertBranch(user, branchId);
  const classId = Number(q.class_id) || null;
  const sectionId = Number(q.section_id) || null;
  const status = q.status === 'left' || q.status === 'all' ? q.status : 'studying';
  const where = `WHERE e.session_id = ?1 AND (?2 IS NULL OR e.branch_id = ?2) AND (?3 IS NULL OR e.class_id = ?3)
    AND (?4 IS NULL OR e.section_id = ?4) ${scopeSql(user, 'e.branch_id')}`;
  const joins = `FROM enrolments e JOIN students s ON s.id = e.student_id JOIN classes cl ON cl.id = e.class_id
    JOIN sections sec ON sec.id = e.section_id JOIN branches b ON b.id = e.branch_id`;
  const args: unknown[] = [session.id, branchId, classId, sectionId];
  // An optional period. The dates were checked (YYYY-MM-DD), so they are safe to write into the query.
  const from = q.from && isValidDate(q.from) ? q.from : '0001-01-01';
  const to = q.to && isValidDate(q.to) ? q.to : '9999-12-31';
  const hasRange = from !== '0001-01-01' || to !== '9999-12-31';
  const periodNote = !hasRange
    ? ''
    : from === '0001-01-01'
      ? `, up to ${to}`
      : to === '9999-12-31'
        ? `, from ${from}`
        : `, ${from} to ${to}`;
  const joinedOn = `date(e.created_at, '+330 minutes')`;

  let columns: ReportColumn[];
  let sql: string;
  let subtitle = session.name;
  switch (report.id) {
    case 'students':
      subtitle = `${session.name}, ${status === 'all' ? 'everyone' : status === 'left' ? 'left' : 'studying'}${hasRange ? `, joined${periodNote}` : ''}`;
      columns = [
        col('admission_no', 'Adm. no'),
        col('name', 'Student'),
        col('father_name', 'Father'),
        col('mother_name', 'Mother'),
        col('class', 'Class'),
        col('roll_no', 'Roll', 'number'),
        col('gender', 'Gender'),
        col('dob', 'Date of birth', 'date'),
        col('phone', 'Phone'),
        col('phone2', 'Phone 2'),
        col('type', 'New/old'),
        col('status', 'Status'),
        col('branch', 'School'),
        col('address', 'Address'),
      ];
      sql = `SELECT s.admission_no, s.name, s.father_name, s.mother_name, cl.name || ' ' || sec.name AS class, e.roll_no,
                    s.gender, s.dob, s.phone, s.phone2, e.admission_type AS type, e.status, b.name AS branch, s.address
             ${joins} ${where} AND (?5 = 'all' OR e.status = ?5)${hasRange ? ` AND ${joinedOn} BETWEEN '${from}' AND '${to}'` : ''}
             ORDER BY b.id, cl.sort_order, sec.name, e.roll_no IS NULL, e.roll_no, s.name`;
      args.push(status);
      break;
    case 'strength':
      columns = [
        col('branch', 'School'),
        col('class', 'Class'),
        col('section', 'Section'),
        col('total', 'Studying', 'number'),
        col('boys', 'Male', 'number'),
        col('girls', 'Female', 'number'),
        col('new', 'New', 'number'),
        col('old', 'Old', 'number'),
        col('left', 'Left', 'number'),
        ...(hasRange ? [col('joined', 'Joined in period', 'number')] : []),
      ];
      if (hasRange) subtitle += `, joined${periodNote}`;
      sql = `SELECT b.name AS branch, cl.name AS class, sec.name AS section,
                    SUM(e.status = 'studying') AS total,
                    SUM(e.status = 'studying' AND s.gender = 'male') AS boys,
                    SUM(e.status = 'studying' AND s.gender = 'female') AS girls,
                    SUM(e.status = 'studying' AND e.admission_type = 'new') AS new,
                    SUM(e.status = 'studying' AND e.admission_type = 'old') AS old,
                    SUM(e.status = 'left') AS left${hasRange ? `, SUM(${joinedOn} BETWEEN '${from}' AND '${to}') AS joined` : ''}
             ${joins} ${where}
             GROUP BY e.branch_id, e.class_id, e.section_id ORDER BY b.id, cl.sort_order, sec.name`;
      break;
    case 'left':
      if (hasRange) subtitle += `, left${periodNote}`;
      columns = [
        col('admission_no', 'Adm. no'),
        col('name', 'Student'),
        col('father_name', 'Father'),
        col('class', 'Class'),
        col('left_date', 'Left on', 'date'),
        col('reason', 'Reason, if the registration was cancelled'),
        col('phone', 'Phone'),
        col('phone2', 'Phone 2'),
        col('branch', 'School'),
      ];
      sql = `SELECT s.admission_no, s.name, s.father_name, cl.name || ' ' || sec.name AS class, e.left_date,
                    COALESCE(e.cancel_reason, '') AS reason, s.phone, s.phone2, b.name AS branch
             ${joins} ${where} AND e.status = 'left'${hasRange ? ` AND e.left_date BETWEEN '${from}' AND '${to}'` : ''} ORDER BY e.left_date DESC, s.name`;
      break;
  }
  const { results } = await db
    .prepare(`${sql} LIMIT ${LIMIT + 1}`)
    .bind(...args)
    .all<Record<string, string | number | null>>();
  const keys = columns.map((cn) => cn.key);
  return c.json<ReportResult>({
    title: `${report.name} · ${subtitle}`,
    columns,
    rows: results
      .slice(0, LIMIT)
      .map((row) => Object.fromEntries(keys.map((k) => [k, row[k] ?? null]))),
    truncated: results.length > LIMIT,
  });
});
