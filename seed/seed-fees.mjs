// Demo fees for local development: discounts for some students and receipts spread from
// April to today. It works through the app's own API, so every rule is applied exactly
// as at the fee counter.
//
//   npm run seed          (students, staff, logins)
//   npm run dev           (in another terminal)
//   npm run seed:fees
//
// Local only: it signs in to http://localhost:8787 with the demo admin login.
const BASE = process.env.SEED_URL ?? 'http://localhost:8787';
let cookie = '';

async function call(method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${data.error ?? res.status}`);
  return data;
}

// Fixed random numbers, so the demo looks the same every time.
let seed = 7;
const rnd = (n) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % n;
};
const pad = (n) => String(n).padStart(2, '0');

await call('POST', '/auth/login', { username: 'admin', password: 'demo12345' });
const boot = await call('GET', '/bootstrap');
const session = boot.sessions.find((s) => s.is_current);
const today = boot.today;
await call('POST', '/fees/sync', { session_id: session.id });

// Every student of the current session.
const students = [];
for (let page = 1; ; page++) {
  const res = await call('GET', `/students?session_id=${session.id}&status=studying&page=${page}`);
  students.push(...res.rows);
  if (students.length >= res.total || res.rows.length === 0) break;
}

// Discounts for about one student in five.
const kinds = [
  {
    reason: 'Sibling',
    change: (i) => (i.amount > 0 ? { discount_type: 'percent', discount_value: 10 } : {}),
  },
  {
    reason: 'Staff ward',
    change: (i) => (i.type === 'monthly' ? { discount_type: 'percent', discount_value: 50 } : {}),
  },
  {
    reason: 'Merit',
    change: (i) =>
      (i.type === 'admission' || i.type === 'annual') && i.amount >= 500
        ? { discount_type: 'amount', discount_value: 500 }
        : {},
  },
];
let discounted = 0;
for (const [n, s] of students.entries()) {
  if (n % 5 !== 2) continue;
  const kind = kinds[discounted % kinds.length];
  const detail = await call('GET', `/fees/students/${s.enrolment_id}`);
  await call('PUT', `/fees/students/${s.enrolment_id}`, {
    months: 12,
    discount_reason: kind.reason,
    items: detail.plan.items.map((i) => ({
      type: i.type,
      amount: i.amount,
      discount_type: 'none',
      discount_value: 0,
      ...kind.change(i),
    })),
  });
  discounted++;
}

// Plan payments: most families pay the admission amount in April, then some months.
const plan = [];
const modes = ['cash', 'cash', 'cash', 'upi', 'upi', 'bank', 'cheque'];
for (const s of students) {
  const detail = await call('GET', `/fees/students/${s.enrolment_id}`);
  const months = detail.allocation.months.filter(
    (m) => `${m.year}-${pad(m.month)}` <= today.slice(0, 7),
  );
  const habit = rnd(10); // 0 = has paid nothing, 1-3 = behind, 4-9 = regular
  if (habit === 0 || months.length === 0) continue;
  const monthly = detail.plan.items.find((i) => i.type === 'monthly');
  const perMonth = monthly.amount - monthly.discount;
  const paidMonths =
    habit <= 3 ? Math.max(1, Math.floor(months.length / 2) - rnd(2)) : months.length - rnd(2);
  months.slice(0, paidMonths).forEach((m, index) => {
    const lastDay = `${m.year}-${pad(m.month)}` === today.slice(0, 7) ? Number(today.slice(8)) : 28;
    const date = `${m.year}-${pad(m.month)}-${pad(1 + rnd(lastDay))}`;
    const amount = index === 0 ? detail.due_at_admission : perMonth;
    if (amount > 0) plan.push({ enrolment_id: s.enrolment_id, date, amount });
  });
}
plan.sort((a, b) => a.date.localeCompare(b.date));

let saved = 0;
const made = [];
for (const [n, p] of plan.entries()) {
  const mode = modes[rnd(modes.length)];
  const counter =
    n % 23 === 5
      ? { counter_discount_type: 'amount', counter_discount_value: 100, note: 'Paid on time' }
      : {};
  try {
    const res = await call('POST', '/fees/receipts', {
      enrolment_id: p.enrolment_id,
      date: p.date,
      settle_amount: p.amount,
      mode,
      reference: mode === 'cash' ? '' : `${mode.toUpperCase()}${100000 + rnd(900000)}`,
      ...counter,
    });
    made.push(res.id);
    saved++;
  } catch (e) {
    console.warn('skipped one payment:', e.message);
  }
}
// Two cancelled receipts, to show how they look.
for (const id of [made[3], made[Math.floor(made.length / 2)]].filter(Boolean)) {
  await call('POST', `/fees/receipts/${id}/cancel`, { reason: 'Entered for the wrong student' });
}
console.log(
  `Fees demo data ready: ${students.length} students, ${discounted} with discounts, ${saved} receipts (2 cancelled).`,
);
