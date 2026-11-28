import { Hono } from 'hono';
import { isValidDate, sessionMonths, todayIST } from '../../../shared/dates';
import {
  allocate,
  CHARGE_LABELS,
  computeDiscount,
  dueAtAdmission,
  feePosition,
  FEE_KEYS,
  lateFee,
  MODE_LABELS,
  PAYMENT_MODES,
  monthsStarted,
  planTotals,
  quickAmounts,
  receiptCovers,
  withDiscounts,
  type FeeAmounts,
  type FeeItem,
  type FeePlan,
  type PaymentMode,
} from '../../../shared/fees';
import type {
  CollectRow,
  FeeRateRow,
  FeesDashboard,
  FeeStudent,
  MoneySums,
  ReceiptDetail,
  ReceiptRow,
  StudentFeeDetail,
  TransportRoute,
} from '../../../shared/fees-api';
import { formatINR } from '../../../shared/format';
import { can } from '../../../shared/permissions';
import type { Paged } from '../../../shared/types';
import { audit } from '../../core/audit';
import { assertBranch, requirePermission, scopeSql } from '../../core/auth';
import { AppError, intParam, notFound, parse } from '../../core/errors';
import type { AppEnv, Ctx } from '../../env';
import { runReport } from './reports';
import {
  cancelInput,
  lateFeeWaiverInput,
  ratesInput,
  ratesStartInput,
  receiptInput,
  studentFeesInput,
  transportRouteInput,
} from './schema';
import {
  afterEnrolments,
  ensureRates,
  lateFeesFor,
  positionSql,
  RATE_COLUMNS,
  refreshPaid,
  STUDENT_JOINS,
} from './service';

export const routes = new Hono<AppEnv>();
const PAGE_SIZE = 30;

// ── Rate chart ──────────────────────────────────────────────────────────────

routes.get('/rates', requirePermission('fees.view'), async (c) => {
  const sessionId = Number(c.req.query('session_id')) || 0;
  const { results } = await c.env.DB.prepare(
    `SELECT branch_id, class_id, admission_type, ${RATE_COLUMNS} FROM fee_rates r WHERE session_id = ? ${scopeSql(c.get('user'), 'r.branch_id')}`,
  )
    .bind(sessionId)
    .all<FeeRateRow>();
  return c.json(results);
});

/** Sets the same fees for chosen classes in chosen branches (new and old students). */
routes.put('/rates', requirePermission('fees.rates.edit'), async (c) => {
  const db = c.env.DB;
  const input = parse(ratesInput, await c.req.json());
  const [session, classes, branches] = await db.batch([
    db.prepare('SELECT name FROM academic_sessions WHERE id = ?').bind(input.session_id),
    db
      .prepare(
        'SELECT id, name FROM classes WHERE id IN (SELECT value FROM json_each(?)) ORDER BY sort_order',
      )
      .bind(JSON.stringify(input.class_ids)),
    db
      .prepare(
        'SELECT id, name FROM branches WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id',
      )
      .bind(JSON.stringify(input.branch_ids)),
  ]);
  const sessionRow = session!.results[0] as { name: string } | undefined;
  const classRows = classes!.results as { id: number; name: string }[];
  const branchRows = branches!.results as { id: number; name: string }[];
  if (!sessionRow) throw notFound('Session');
  if (
    classRows.length !== new Set(input.class_ids).size ||
    branchRows.length !== new Set(input.branch_ids).size
  ) {
    throw new AppError(
      400,
      'One of the chosen classes or branches does not exist. Reload the page and try again.',
    );
  }
  for (const type of ['new', 'old'] as const) {
    const a = input[type];
    if (a.practical_alt > 0 && a.practical_alt <= a.practical) {
      throw new AppError(
        400,
        'The higher practical option must be more than the normal practical fee, or 0 if there is no second option.',
        {
          [`${type}.practical_alt`]: 'Must be more than practical',
        },
      );
    }
  }
  const now = new Date().toISOString();
  const rows = branchRows.flatMap((b) =>
    classRows.flatMap((cls) =>
      (['new', 'old'] as const).map((type) => ({
        branch_id: b.id,
        class_id: cls.id,
        admission_type: type,
        ...input[type],
      })),
    ),
  );
  await db.batch([
    // Make sure untouched classes of these branches have their rows before changing some.
    ...ensureRates(db, '?1', input.session_id),
    db
      .prepare(
        `INSERT INTO fee_rates (session_id, branch_id, class_id, admission_type, ${RATE_COLUMNS}, updated_at)
         SELECT ?1, j.value->>'branch_id', j.value->>'class_id', j.value->>'admission_type', ${FEE_KEYS.map((k) => `j.value->>'${k}'`).join(', ')}, ?2
           FROM json_each(?3) j WHERE true
         ON CONFLICT (session_id, branch_id, class_id, admission_type) DO UPDATE SET
           ${FEE_KEYS.map((k) => `${k} = excluded.${k}`).join(', ')}, updated_at = excluded.updated_at`,
      )
      .bind(input.session_id, now, JSON.stringify(rows)),
    audit(c, {
      action: 'update',
      entity: 'fee_rates',
      summary: `Changed the fee rate chart of ${sessionRow.name} for ${classRows.map((cls) => cls.name).join(', ')} (${branchRows.map((b) => b.name).join(', ')})`,
      details: { new: input.new, old: input.old },
    }),
  ]);
  return c.json({ ok: true });
});

/** Gives every branch that has no chart for the session a starting chart. */
routes.post('/rates/start', requirePermission('fees.rates.edit'), async (c) => {
  const db = c.env.DB;
  const body = parse(ratesStartInput, await c.req.json());
  const session = await db
    .prepare('SELECT name FROM academic_sessions WHERE id = ?')
    .bind(body.session_id)
    .first<{ name: string }>();
  if (!session) throw notFound('Session');
  await db.batch([
    ...ensureRates(db, '?1', body.session_id),
    audit(c, {
      action: 'create',
      entity: 'fee_rates',
      summary: `Started the fee rate chart of ${session.name}`,
    }),
  ]);
  return c.json({ ok: true });
});

// ── One student's fees ──────────────────────────────────────────────────────

interface FeeRow {
  months: number;
  items: string;
  discount_reason: string;
  paid: number;
  counter_discount: number;
  late_fee_paid: number;
  late_fee_waived: number;
  transport_route_id: number | null;
  transport_from: string;
  transport_to: string;
}
type RawReceipt = Omit<ReceiptRow, 'covers'>;

const STUDENT_SELECT = `SELECT e.id AS enrolment_id, s.id AS student_id, s.admission_no, s.name, s.father_name, s.phone, s.phone2,
  e.branch_id, e.class_id, sec.name AS section_name, e.roll_no, e.admission_type, e.status,
  e.cancel_reason, date(e.created_at, '+330 minutes') AS joined_on,
  e.session_id, ses.name AS session_name, ses.start_year, ses.start_month
  FROM enrolments e JOIN students s ON s.id = e.student_id JOIN sections sec ON sec.id = e.section_id
  JOIN academic_sessions ses ON ses.id = e.session_id WHERE e.id = ?`;
const RECEIPT_COLUMNS = `id, receipt_no, date, amount, late_fee, counter_discount, mode, reference, note, collected_by_name, cancelled_at, cancelled_by_name, cancel_reason`;

/** Reads a student's fees (setting them up from the rate chart on first use) and works out where they stand. */
async function loadStudentFees(
  c: Ctx,
  enrolmentId: number,
): Promise<StudentFeeDetail & { raw: FeeRow }> {
  const db = c.env.DB;
  const read = () =>
    db.batch([
      db.prepare(STUDENT_SELECT).bind(enrolmentId),
      db
        .prepare(
          `SELECT months, items, discount_reason, paid, counter_discount, late_fee_paid, late_fee_waived,
                  transport_route_id, transport_from, transport_to FROM student_fees WHERE enrolment_id = ?`,
        )
        .bind(enrolmentId),
      db
        .prepare(`SELECT ${RECEIPT_COLUMNS} FROM receipts WHERE enrolment_id = ? ORDER BY id`)
        .bind(enrolmentId),
      db
        .prepare(
          `SELECT ${RATE_COLUMNS} FROM fee_rates r JOIN enrolments e ON e.id = ?
            AND r.session_id = e.session_id AND r.branch_id = e.branch_id AND r.class_id = e.class_id AND r.admission_type = e.admission_type`,
        )
        .bind(enrolmentId),
      db
        .prepare(
          'SELECT id, amount, reason, by_name, at FROM late_fee_waivers WHERE enrolment_id = ? ORDER BY id DESC',
        )
        .bind(enrolmentId),
    ]);
  const first = await read();
  let [, feeRes, receiptRes, rateRes, waiverRes] = first;
  const student = first[0]!.results[0] as FeeStudent | undefined;
  if (!student) throw notFound('Student');
  assertBranch(c.get('user'), student.branch_id);
  if (!feeRes!.results.length) {
    await db.batch(afterEnrolments(db, student.session_id));
    [, feeRes, receiptRes, rateRes, waiverRes] = await read();
  }
  const raw = feeRes!.results[0] as FeeRow | undefined;
  if (!raw)
    throw new AppError(
      409,
      'Fees could not be set up for this student. Check the rate chart for their class and try again.',
    );

  // Fees saved before previous dues and transport existed get those two filled in (at 0).
  const plan: FeePlan = {
    items: withDiscounts(JSON.parse(raw.items) as FeeItem[]),
    months: raw.months,
  };
  const started = monthsStarted(student, todayIST());
  const left = student.status === 'left';
  const position = feePosition(plan, raw, started, left);
  let running = 0;
  const raws = receiptRes!.results as RawReceipt[];
  const receipts = raws.map((r) => {
    if (r.cancelled_at) return { ...r, covers: '' };
    // What this receipt cleared of the fees: the money for fees plus any discount (not the late fee).
    const now = r.amount - r.late_fee + r.counter_discount;
    const covers = receiptCovers(plan, running, now, student);
    running += now;
    return { ...r, covers };
  });
  const late = lateFee(
    plan,
    student,
    raws
      .filter((r) => !r.cancelled_at)
      .map((r) => ({ date: r.date, settled: r.amount - r.late_fee + r.counter_discount })),
    todayIST(),
    {
      paid: raw.late_fee_paid,
      waived: raw.late_fee_waived,
      left,
      joinedOn: student.joined_on,
    },
  );
  return {
    student,
    plan,
    discount_reason: raw.discount_reason,
    rate: (rateRes!.results[0] as FeeAmounts | undefined) ?? null,
    position,
    allocation: allocate(plan, position.settled, student, started, left),
    due_at_admission: dueAtAdmission(plan),
    quick: quickAmounts(plan, position),
    late_fee: late,
    waivers: waiverRes!.results as StudentFeeDetail['waivers'],
    transport:
      raw.transport_route_id || raw.transport_from
        ? { route_id: raw.transport_route_id, from: raw.transport_from, to: raw.transport_to }
        : null,
    receipts: receipts.reverse(),
    raw,
  };
}

routes.get('/students/:id', requirePermission('fees.view'), async (c) => {
  const { raw: _raw, ...detail } = await loadStudentFees(c, intParam(c.req.param('id'), 'Student'));
  void _raw;
  return c.json<StudentFeeDetail>(detail);
});

/** Saves a student's fees: amount and discount per fee type, months, discount reason. */
routes.put('/students/:id', requirePermission('fees.edit'), async (c) => {
  const db = c.env.DB;
  const id = intParam(c.req.param('id'), 'Student');
  const input = parse(studentFeesInput, await c.req.json());
  const current = await loadStudentFees(c, id);
  for (const item of input.items) {
    if (item.discount_type === 'percent' && item.discount_value > 100) {
      throw new AppError(
        400,
        `The discount on ${CHARGE_LABELS[item.type]} cannot be more than 100%.`,
      );
    }
    if (item.discount_type === 'amount' && item.discount_value > item.amount) {
      throw new AppError(
        400,
        `The discount on ${CHARGE_LABELS[item.type]} (${formatINR(item.discount_value)}) is more than the fee (${formatINR(item.amount)}).`,
      );
    }
  }
  let route: { id: number; branch_id: number; source: string; destination: string } | null = null;
  if (input.transport_route_id) {
    route = await db
      .prepare('SELECT id, branch_id, source, destination FROM transport_routes WHERE id = ?')
      .bind(input.transport_route_id)
      .first<{ id: number; branch_id: number; source: string; destination: string }>();
    if (!route || route.branch_id !== current.student.branch_id)
      throw new AppError(400, 'Choose a transport route of this student’s school.', {
        transport_route_id: 'Not found',
      });
  } else if ((input.items.find((i) => i.type === 'transport')?.amount ?? 0) > 0) {
    throw new AppError(
      400,
      'Choose the transport route for the transport fee, or set the transport fee to 0.',
      { transport_route_id: 'Choose a route' },
    );
  }
  const plan: FeePlan = { items: withDiscounts(input.items), months: input.months };
  const totals = planTotals(plan);
  const hasDiscount = plan.items.some((i) => i.discount > 0);
  if (current.student.status !== 'left' && totals.net < current.position.settled) {
    throw new AppError(
      400,
      `This student has already paid ${formatINR(current.position.settled)}, which is more than the new fee of ${formatINR(totals.net)}. Reduce the discount, or cancel a receipt first.`,
    );
  }
  await db.batch([
    db
      .prepare(
        `UPDATE student_fees SET months = ?, items = ?, one_time_gross = ?, one_time_net = ?, monthly_gross = ?, monthly_net = ?,
                discount_reason = ?, transport_route_id = ?, transport_from = ?, transport_to = ?, updated_at = ?
          WHERE enrolment_id = ?`,
      )
      .bind(
        input.months,
        JSON.stringify(plan.items),
        totals.one_time_gross,
        totals.one_time_net,
        totals.monthly_gross,
        totals.monthly_net,
        hasDiscount ? input.discount_reason : '',
        route?.id ?? null,
        route?.source ?? '',
        route?.destination ?? '',
        new Date().toISOString(),
        id,
      ),
    audit(c, {
      action: 'update',
      entity: 'student_fees',
      entity_id: id,
      branch_id: current.student.branch_id,
      summary: `Changed fees of ${current.student.name}: ${formatINR(totals.net)} for the year, discount ${formatINR(totals.discount)}`,
      details: { before: current.plan, after: plan, reason: input.discount_reason },
    }),
  ]);
  return c.json({ ok: true });
});

// ── Collect ─────────────────────────────────────────────────────────────────

/** Search for a student to collect from; with no search, students overdue today. */
routes.get('/collect', requirePermission('fees.collect'), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const q = c.req.query();
  const page = Math.max(1, Number(q.page) || 1);
  const sessionId = Number(q.session_id) || 0;
  const session = await db
    .prepare('SELECT start_year, start_month FROM academic_sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ start_year: number; start_month: number }>();
  if (!session) throw notFound('Session');
  const pos = positionSql(monthsStarted(session, todayIST()));
  const where = ['e.session_id = ?'];
  const params: unknown[] = [sessionId];
  if (Number(q.branch_id)) {
    where.push('e.branch_id = ?');
    params.push(Number(q.branch_id));
  }
  const search = (q.q ?? '').trim().slice(0, 50);
  if (search) {
    const like = `%${search.replace(/[%_\\]/g, '\\$&')}%`;
    where.push(
      `(s.name LIKE ? ESCAPE '\\' OR s.father_name LIKE ? ESCAPE '\\' OR s.phone LIKE ? ESCAPE '\\' OR s.phone2 LIKE ? ESCAPE '\\' OR s.admission_no LIKE ? ESCAPE '\\' OR e.roll_no = ?)`,
    );
    params.push(like, like, like, like, like, /^\d+$/.test(search) ? Number(search) : -1);
  } else {
    where.push(`${pos.overdue} > 0`);
  }
  const from = `${STUDENT_JOINS} WHERE ${where.join(' AND ')} ${scopeSql(user, 'e.branch_id')}`;
  const [rows, count] = await db.batch([
    db
      .prepare(
        `SELECT e.id AS enrolment_id, s.id AS student_id, s.name, s.father_name, s.phone, e.branch_id, e.class_id,
                sec.name AS section_name, e.roll_no, e.status, ${pos.pending} AS pending, ${pos.overdue} AS overdue
         ${from} ORDER BY ${search ? 'cl.sort_order, sec.name, e.roll_no IS NULL, e.roll_no, s.name' : 'overdue DESC, s.name'} LIMIT ? OFFSET ?`,
      )
      .bind(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    db.prepare(`SELECT COUNT(*) AS n ${from}`).bind(...params),
  ]);
  const found = rows!.results as Omit<CollectRow, 'late_fee'>[];
  const late = await lateFeesFor(
    db,
    found.map((r) => r.enrolment_id),
    todayIST(),
  );
  return c.json<Paged<CollectRow>>({
    rows: found.map((r) => ({ ...r, late_fee: late.get(r.enrolment_id)?.outstanding ?? 0 })),
    page,
    page_size: PAGE_SIZE,
    total: (count!.results[0] as { n: number }).n,
  });
});

routes.post('/receipts', requirePermission('fees.collect'), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const input = parse(receiptInput, await c.req.json());
  const today = todayIST();
  if (input.date > today)
    throw new AppError(
      400,
      'The receipt date cannot be in the future. Choose today or an earlier date.',
      { date: 'In the future' },
    );
  const fees = await loadStudentFees(c, input.enrolment_id);
  const { student, position } = fees;
  if (student.status === 'left')
    throw new AppError(
      400,
      'This student has left the school and owes nothing further, so no fee can be collected.',
    );
  if (input.counter_discount_type === 'percent' && input.counter_discount_value > 100) {
    throw new AppError(400, 'The discount cannot be more than 100%.', {
      counter_discount_value: 'Too much',
    });
  }

  // How much of the fees this receipt clears, the discount, and the money taken for fees.
  //  - 'payment': the amount entered is what gets cleared; the discount comes out of it.
  //  - 'total': the discount is worked out on everything still pending, and comes on top of
  //    the money taken, so an overall discount comes off the total fees.
  let cleared: number;
  let discount: number;
  let feeCash: number;
  if (input.discount_basis === 'total') {
    discount = computeDiscount(
      position.pending,
      input.counter_discount_type,
      input.counter_discount_value,
    );
    if (
      input.counter_discount_type === 'amount' &&
      input.counter_discount_value > position.pending
    ) {
      throw new AppError(
        400,
        `The discount (${formatINR(input.counter_discount_value)}) is more than what is pending (${formatINR(position.pending)}).`,
        { counter_discount_value: 'Too much' },
      );
    }
    feeCash = input.settle_amount;
    cleared = feeCash + discount;
  } else {
    cleared = input.settle_amount;
    discount = computeDiscount(cleared, input.counter_discount_type, input.counter_discount_value);
    if (input.counter_discount_type === 'amount' && input.counter_discount_value > cleared) {
      throw new AppError(400, 'The discount cannot be more than the amount being cleared.', {
        counter_discount_value: 'Too much',
      });
    }
    feeCash = cleared - discount;
  }
  if (cleared > position.pending) {
    throw new AppError(
      400,
      `Only ${formatINR(position.pending)} is pending for this student. Enter ${formatINR(position.pending)} or less.`,
      { settle_amount: 'More than pending' },
    );
  }

  // The late fee: taken in full or in part, or waived (admin and management).
  const owed = fees.late_fee.outstanding;
  if (input.waive_late_fee && !can(user.role, 'fees.waive'))
    throw new AppError(403, 'Only the admin or management can waive a late fee.');
  const waived = input.waive_late_fee ? owed : 0;
  const lateTaken = input.waive_late_fee ? 0 : input.late_fee;
  if (lateTaken > owed) {
    throw new AppError(
      400,
      owed > 0
        ? `The late fee owed is ${formatINR(owed)}. Enter ${formatINR(owed)} or less.`
        : 'There is no late fee owed for this student.',
      { late_fee: 'More than owed' },
    );
  }
  const amount = feeCash + lateTaken;
  if (cleared === 0 && lateTaken === 0) {
    throw new AppError(400, 'Enter an amount more than 0.', { settle_amount: 'Enter an amount' });
  }
  if (input.mode !== 'cash' && amount > 0 && !input.reference) {
    throw new AppError(
      400,
      `Enter the reference number for the ${MODE_LABELS[input.mode]} payment.`,
      { reference: 'Required' },
    );
  }
  const now = new Date().toISOString();
  const [inserted] = await db.batch([
    db
      .prepare(
        // The running number and the "not more than pending" check happen inside the insert,
        // so two people saving at the same moment cannot clash or over-collect.
        `INSERT INTO receipts (receipt_no, branch_id, seq, enrolment_id, student_id, session_id, date, amount, late_fee, counter_discount,
                counter_discount_type, counter_discount_value, mode, reference, note, collected_by, collected_by_name, created_at)
         SELECT b.code || '-' || printf('%05d', n.seq), b.id, n.seq, ?2, ?3, ?4, ?5, ?6, ?18, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15
           FROM branches b, (SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM receipts WHERE branch_id = ?1) n
          WHERE b.id = ?1
            AND (SELECT paid + counter_discount FROM student_fees WHERE enrolment_id = ?2) + ?16 <= ?17`,
      )
      .bind(
        student.branch_id,
        student.enrolment_id,
        student.student_id,
        student.session_id,
        input.date,
        amount,
        discount,
        discount > 0 ? input.counter_discount_type : 'none',
        discount > 0 ? input.counter_discount_value : 0,
        input.mode,
        input.reference,
        input.note,
        user.id,
        user.name,
        now,
        cleared,
        position.net,
        lateTaken,
      ),
    refreshPaid(db, student.enrolment_id),
    // A waived late fee is written down with who gave it, in the same step as the receipt
    // (and only if that receipt was saved).
    db
      .prepare(
        `INSERT INTO late_fee_waivers (enrolment_id, amount, reason, by_name, at)
         SELECT ?1, ?2, ?3, ?4, ?5
          WHERE ?2 > 0 AND EXISTS (SELECT 1 FROM receipts r WHERE r.enrolment_id = ?1 AND r.created_at = ?5 AND r.collected_by = ?6)`,
      )
      .bind(
        student.enrolment_id,
        waived,
        input.note || 'Waived at the counter',
        user.name,
        now,
        user.id,
      ),
    db
      .prepare(
        `UPDATE student_fees SET late_fee_waived = late_fee_waived + ?2
          WHERE enrolment_id = ?1 AND ?2 > 0
            AND EXISTS (SELECT 1 FROM receipts r WHERE r.enrolment_id = ?1 AND r.created_at = ?3 AND r.collected_by = ?4)`,
      )
      .bind(student.enrolment_id, waived, now, user.id),
    db
      .prepare(
        `INSERT INTO audit_log (at, user_id, user_name, action, entity, entity_id, branch_id, summary)
         SELECT ?1, ?2, ?3, 'create', 'receipt', r.id, r.branch_id,
                'Receipt ' || r.receipt_no || ': ' || ?4 || ' from ' || ?5
           FROM receipts r WHERE r.enrolment_id = ?6 AND r.created_at = ?1 AND r.collected_by = ?2`,
      )
      .bind(
        now,
        user.id,
        user.name,
        `${formatINR(amount)}${lateTaken ? ` (late fee ${formatINR(lateTaken)})` : ''}${discount ? ` + ${formatINR(discount)} discount` : ''}${waived ? `, late fee ${formatINR(waived)} waived` : ''}`,
        student.name,
        student.enrolment_id,
      ),
  ]);
  if (!inserted!.meta.changes) {
    throw new AppError(
      409,
      'This student’s balance changed just now, maybe from another phone. Reload the page and check before collecting again.',
    );
  }
  return c.json({ ok: true, id: inserted!.meta.last_row_id });
});

async function loadReceipt(c: Ctx, id: number) {
  const row = await c.env.DB.prepare(
    `SELECT ${RECEIPT_COLUMNS}, enrolment_id, branch_id FROM receipts WHERE id = ?`,
  )
    .bind(id)
    .first<RawReceipt & { enrolment_id: number; branch_id: number }>();
  if (!row) throw notFound('Receipt');
  assertBranch(c.get('user'), row.branch_id);
  return row;
}

routes.get('/receipts/:id', requirePermission('fees.view'), async (c) => {
  const db = c.env.DB;
  const id = intParam(c.req.param('id'), 'Receipt');
  const row = await loadReceipt(c, id);
  const fees = await loadStudentFees(c, row.enrolment_id);
  const [branch, settings] = await db.batch([
    db.prepare('SELECT name, address, phone FROM branches WHERE id = ?').bind(row.branch_id),
    db.prepare(
      "SELECT key, value FROM settings WHERE key IN ('school_name', 'school_address', 'logo')",
    ),
  ]);
  const map = Object.fromEntries(
    (settings!.results as { key: string; value: string }[]).map((r) => [r.key, r.value]),
  );
  return c.json<ReceiptDetail>({
    receipt: fees.receipts.find((r) => r.id === id)!,
    student: fees.student,
    branch: branch!.results[0] as ReceiptDetail['branch'],
    school: {
      name: map.school_name ?? '',
      address: map.school_address ?? '',
      logo: map.logo ?? '',
    },
    pending: fees.position.pending,
    overdue: fees.position.overdue,
    late_fee: fees.late_fee.outstanding,
  });
});

/** Cancels a receipt with a reason. It stays on record, struck through; the balance recalculates. */
routes.post('/receipts/:id/cancel', requirePermission('fees.cancel'), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const id = intParam(c.req.param('id'), 'Receipt');
  const input = parse(cancelInput, await c.req.json());
  const row = await loadReceipt(c, id);
  if (row.cancelled_at) throw new AppError(409, 'This receipt is already cancelled.');
  await db.batch([
    db
      .prepare(
        'UPDATE receipts SET cancelled_at = ?, cancelled_by_name = ?, cancel_reason = ? WHERE id = ? AND cancelled_at IS NULL',
      )
      .bind(new Date().toISOString(), user.name, input.reason, id),
    refreshPaid(db, row.enrolment_id),
    audit(c, {
      action: 'cancel',
      entity: 'receipt',
      entity_id: id,
      branch_id: row.branch_id,
      summary: `Cancelled receipt ${row.receipt_no} (${formatINR(row.amount)}): ${input.reason}`,
    }),
  ]);
  return c.json({ ok: true });
});

/** Waives a late fee (all of what is owed, or part of it) with a reason; it stays on record. */
routes.post('/students/:id/late-fee-waiver', requirePermission('fees.waive'), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const id = intParam(c.req.param('id'), 'Student');
  const input = parse(lateFeeWaiverInput, await c.req.json());
  const fees = await loadStudentFees(c, id);
  const owed = fees.late_fee.outstanding;
  if (owed <= 0) throw new AppError(400, 'There is no late fee owed for this student.');
  const amount = input.amount ?? owed;
  if (amount > owed)
    throw new AppError(
      400,
      `The late fee owed is ${formatINR(owed)}. Enter ${formatINR(owed)} or less.`,
      {
        amount: 'More than owed',
      },
    );
  await db.batch([
    db
      .prepare(
        'INSERT INTO late_fee_waivers (enrolment_id, amount, reason, by_name, at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(id, amount, input.reason, user.name, new Date().toISOString()),
    db
      .prepare(
        'UPDATE student_fees SET late_fee_waived = late_fee_waived + ? WHERE enrolment_id = ?',
      )
      .bind(amount, id),
    audit(c, {
      action: 'update',
      entity: 'student_fees',
      entity_id: id,
      branch_id: fees.student.branch_id,
      summary: `Waived late fee of ${formatINR(amount)} for ${fees.student.name}: ${input.reason}`,
    }),
  ]);
  return c.json({ ok: true });
});

// ── Transport routes ────────────────────────────────────────────────────────

routes.get('/transport-routes', requirePermission('fees.view'), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.branch_id, t.source, t.destination, t.monthly_fee, t.active
       FROM transport_routes t WHERE 1 ${scopeSql(c.get('user'), 't.branch_id')}
      ORDER BY t.branch_id, t.source, t.destination`,
  ).all<TransportRoute>();
  return c.json<TransportRoute[]>(results);
});

async function saveRoute(c: Ctx, id: number | null) {
  const db = c.env.DB;
  const input = parse(transportRouteInput, await c.req.json());
  assertBranch(c.get('user'), input.branch_id);
  try {
    if (id === null) {
      await db.batch([
        db
          .prepare(
            'INSERT INTO transport_routes (branch_id, source, destination, monthly_fee, active, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .bind(
            input.branch_id,
            input.source,
            input.destination,
            input.monthly_fee,
            input.active ? 1 : 0,
            new Date().toISOString(),
          ),
        audit(c, {
          action: 'create',
          entity: 'transport_route',
          entity_id: 'last',
          branch_id: input.branch_id,
          summary: `Added transport route ${input.source} to ${input.destination} (${formatINR(input.monthly_fee)} a month)`,
        }),
      ]);
    } else {
      const [res] = await db.batch([
        db
          .prepare(
            'UPDATE transport_routes SET source = ?, destination = ?, monthly_fee = ?, active = ? WHERE id = ? AND branch_id = ?',
          )
          .bind(
            input.source,
            input.destination,
            input.monthly_fee,
            input.active ? 1 : 0,
            id,
            input.branch_id,
          ),
        audit(c, {
          action: 'update',
          entity: 'transport_route',
          entity_id: id,
          branch_id: input.branch_id,
          summary: `Changed transport route ${input.source} to ${input.destination}: ${formatINR(input.monthly_fee)} a month. Students already on it keep their fee until it is changed on their fees.`,
        }),
      ]);
      if (!res!.meta.changes) throw notFound('Transport route');
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (String(e).includes('UNIQUE'))
      throw new AppError(409, 'This school already has a route with the same start and end.', {
        destination: 'Already used',
      });
    throw e;
  }
  return c.json({ ok: true });
}

routes.post('/transport-routes', requirePermission('fees.rates.edit'), (c) => saveRoute(c, null));
routes.put('/transport-routes/:id', requirePermission('fees.rates.edit'), (c) =>
  saveRoute(c, intParam(c.req.param('id'), 'Transport route')),
);

// ── Dashboard ───────────────────────────────────────────────────────────────

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The fee dashboard. Filters: school, class, payment mode and a date range. The money
 * position (to pay, collected, pending, overdue) is always as of today; the date range
 * decides which collections are counted in the range figures and the daily chart.
 */
routes.get('/dashboard', requirePermission('fees.view'), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const q = c.req.query();
  const sessionId = Number(q.session_id) || 0;
  const branchId = Number(q.branch_id) || null;
  const classId = Number(q.class_id) || null;
  const mode = PAYMENT_MODES.find((m) => m === q.mode) ?? null;
  if (branchId) assertBranch(user, branchId);
  const session = await db
    .prepare('SELECT start_year, start_month FROM academic_sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ start_year: number; start_month: number }>();
  if (!session) throw notFound('Session');
  const today = todayIST();
  const sessionStart = `${session.start_year}-${String(session.start_month).padStart(2, '0')}-01`;
  const from = q.from && isValidDate(q.from) ? q.from : sessionStart;
  const to = q.to && isValidDate(q.to) ? q.to : today;
  if (from > to) throw new AppError(400, 'The "from" date is after the "to" date. Swap them.');
  const rangeDays =
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (rangeDays > 400) throw new AppError(400, 'Choose a date range of at most one year.');

  const pos = positionSql(monthsStarted(session, today));
  const sums = `COUNT(*) AS students, SUM(${pos.fee}) AS fee, SUM(${pos.discount}) AS discount, SUM(${pos.net}) AS net, SUM(${pos.paid}) AS paid,
    SUM(${pos.counter_discount}) AS counter_discount, SUM(${pos.pending}) AS pending, SUM(${pos.overdue}) AS overdue`;
  const where = `WHERE e.session_id = ?1 AND (?2 IS NULL OR e.branch_id = ?2) AND (?3 IS NULL OR e.class_id = ?3) ${scopeSql(user, 'e.branch_id')}`;
  const receiptWhere = `WHERE r.session_id = ?1 AND (?2 IS NULL OR r.branch_id = ?2)
    AND (?3 IS NULL OR r.enrolment_id IN (SELECT id FROM enrolments WHERE class_id = ?3))
    AND (?4 IS NULL OR r.mode = ?4) ${scopeSql(user, 'r.branch_id')}`;
  const studentArgs = [sessionId, branchId, classId];
  const receiptArgs = [sessionId, branchId, classId, mode];
  const monthCols = Array.from(
    { length: 12 },
    (_, i) => `SUM(CASE WHEN f.months >= ${i + 1} THEN f.monthly_net ELSE 0 END) AS m${i + 1}`,
  ).join(', ');
  const [byBranch, byClass, missing, byDay, largest, latest, dueRow] = await db.batch([
    db
      .prepare(
        `SELECT e.branch_id, ${sums} FROM enrolments e LEFT JOIN student_fees f ON f.enrolment_id = e.id ${where} GROUP BY e.branch_id`,
      )
      .bind(...studentArgs),
    db
      .prepare(
        `SELECT e.class_id, ${sums} FROM enrolments e LEFT JOIN student_fees f ON f.enrolment_id = e.id ${where} GROUP BY e.class_id`,
      )
      .bind(...studentArgs),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM enrolments e LEFT JOIN student_fees f ON f.enrolment_id = e.id ${where} AND f.enrolment_id IS NULL`,
      )
      .bind(...studentArgs),
    db
      .prepare(
        `SELECT r.date, r.mode, SUM(r.amount) AS amount, COUNT(*) AS receipts FROM receipts r ${receiptWhere} AND r.cancelled_at IS NULL GROUP BY r.date, r.mode`,
      )
      .bind(...receiptArgs),
    db
      .prepare(
        `SELECT e.id AS enrolment_id, s.id AS student_id, s.name, s.father_name, s.phone, s.phone2, e.branch_id, e.class_id,
                sec.name AS section_name, e.roll_no, e.status, ${pos.pending} AS pending, ${pos.overdue} AS overdue
         ${STUDENT_JOINS} ${where} AND ${pos.overdue} > 0 ORDER BY overdue DESC LIMIT 10`,
      )
      .bind(...studentArgs),
    db
      .prepare(
        `SELECT r.id, r.receipt_no, r.date, s.name, r.amount, r.mode, r.cancelled_at IS NOT NULL AS cancelled
           FROM receipts r JOIN students s ON s.id = r.student_id ${receiptWhere} ORDER BY r.id DESC LIMIT 10`,
      )
      .bind(...receiptArgs),
    db
      .prepare(
        `SELECT COALESCE(SUM(f.one_time_net), 0) AS one_time, ${monthCols}
           FROM enrolments e JOIN student_fees f ON f.enrolment_id = e.id ${where} AND e.status = 'studying'`,
      )
      .bind(...studentArgs),
  ]);
  const branchRows = byBranch!.results as FeesDashboard['by_branch'];
  const total: MoneySums = {
    students: 0,
    fee: 0,
    discount: 0,
    net: 0,
    paid: 0,
    counter_discount: 0,
    pending: 0,
    overdue: 0,
  };
  for (const row of branchRows)
    for (const key of Object.keys(total) as (keyof MoneySums)[]) total[key] += row[key];

  const days = byDay!.results as {
    date: string;
    mode: PaymentMode;
    amount: number;
    receipts: number;
  }[];
  const sumWhere = (test: (date: string) => boolean) =>
    days.filter((d) => test(d.date)).reduce((sum, d) => sum + d.amount, 0);
  const inRange = (d: string) => d >= from && d <= to;
  const weekAgo = addDays(today, -6);
  const modes = new Map<PaymentMode, { amount: number; receipts: number }>();
  for (const d of days.filter((x) => inRange(x.date))) {
    const m = modes.get(d.mode) ?? { amount: 0, receipts: 0 };
    modes.set(d.mode, { amount: m.amount + d.amount, receipts: m.receipts + d.receipts });
  }
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(from, -rangeDays);
  const due = (dueRow!.results[0] ?? {}) as Record<string, number | null>;
  return c.json<FeesDashboard>({
    total,
    missing_fees: (missing!.results[0] as { n: number }).n,
    by_branch: branchRows,
    by_class: byClass!.results as FeesDashboard['by_class'],
    today: sumWhere((d) => d === today),
    last_7_days: sumWhere((d) => d >= weekAgo && d <= today),
    this_month: sumWhere((d) => d.slice(0, 7) === today.slice(0, 7)),
    by_month: sessionMonths(session.start_year, session.start_month).map(({ year, month }, i) => ({
      year,
      month,
      amount: sumWhere((d) => d.slice(0, 7) === `${year}-${String(month).padStart(2, '0')}`),
      due: (i === 0 ? Number(due.one_time ?? 0) : 0) + Number(due[`m${i + 1}`] ?? 0),
    })),
    last_14_days: Array.from({ length: 14 }, (_, i) => addDays(today, i - 13)).map((date) => ({
      date,
      amount: sumWhere((d) => d === date),
    })),
    range: {
      from,
      to,
      collected: sumWhere(inRange),
      receipts: days.filter((d) => inRange(d.date)).reduce((n, d) => n + d.receipts, 0),
      previous_collected:
        prevFrom >= sessionStart ? sumWhere((d) => d >= prevFrom && d <= prevTo) : null,
      days: Array.from({ length: rangeDays }, (_, i) => addDays(from, i)).map((date) => ({
        date,
        amount: sumWhere((d) => d === date),
      })),
    },
    by_mode: [...modes.entries()].map(([m, v]) => ({ mode: m, ...v })),
    largest_dues: largest!.results as FeesDashboard['largest_dues'],
    latest_receipts: latest!.results as FeesDashboard['latest_receipts'],
  });
});

/** Sets up fees from the rate chart for students of a session who have none (e.g. after a restore). */
routes.post('/sync', requirePermission('fees.edit'), async (c) => {
  const body = (await c.req.json()) as { session_id?: number };
  const sessionId = Number(body.session_id) || 0;
  const session = await c.env.DB.prepare('SELECT id FROM academic_sessions WHERE id = ?')
    .bind(sessionId)
    .first();
  if (!session) throw notFound('Session');
  await c.env.DB.batch(afterEnrolments(c.env.DB, sessionId));
  return c.json({ ok: true });
});

// ── Reports ─────────────────────────────────────────────────────────────────

routes.get('/reports/:name', requirePermission('fees.view'), async (c) =>
  c.json(await runReport(c, c.req.param('name'), c.req.query())),
);
