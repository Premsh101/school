// Fee rate chart: shared types and the pure money functions for it.
// All amounts are whole rupees (integers).

export const FEE_KEYS = [
  'registration',
  'admission',
  'board',
  'annual',
  'practical',
  'practical_alt',
  'tbdb',
  'monthly',
] as const;
export type FeeKey = (typeof FEE_KEYS)[number];
export type FeeAmounts = Record<FeeKey, number>;

export const FEE_LABELS: Record<FeeKey, string> = {
  registration: 'Registration',
  admission: 'Admission',
  board: 'Board fee / registration',
  annual: 'Annual charge',
  practical: 'Practical',
  practical_alt: 'Practical (higher option)',
  tbdb: 'TBDB etc.',
  monthly: 'Monthly fee',
};

export interface FeeRate extends FeeAmounts {
  class_id: number;
  admission_type: 'new' | 'old';
}

const zero: FeeAmounts = {
  registration: 0,
  admission: 0,
  board: 0,
  annual: 0,
  practical: 0,
  practical_alt: 0,
  tbdb: 0,
  monthly: 0,
};
export const emptyAmounts = (): FeeAmounts => ({ ...zero });

/**
 * The printed chart for session 2026-27. Classes are given by their order
 * (Nursery = 1, KG 1 = 2, KG 2 = 3, Class 1 = 4 … Class 12 = 15).
 * Used to fill the chart of the first session; later sessions copy the previous one.
 */
export const DEFAULT_RATE_CHART: {
  from_order: number;
  to_order: number;
  new: FeeAmounts;
  old: FeeAmounts;
}[] = [
  {
    from_order: 1,
    to_order: 3,
    new: { ...zero, registration: 100, admission: 2500, tbdb: 500, monthly: 700 },
    old: { ...zero, annual: 1800, monthly: 700 },
  },
  {
    from_order: 4,
    to_order: 8,
    new: { ...zero, registration: 100, admission: 3000, tbdb: 500, monthly: 800 },
    old: { ...zero, annual: 2000, monthly: 800 },
  },
  {
    from_order: 9,
    to_order: 11,
    new: { ...zero, registration: 100, admission: 3200, tbdb: 600, monthly: 900 },
    old: { ...zero, annual: 2200, monthly: 900 },
  },
  {
    from_order: 12,
    to_order: 12,
    new: {
      ...zero,
      registration: 200,
      admission: 3500,
      board: 1000,
      practical: 600,
      tbdb: 700,
      monthly: 1200,
    },
    old: { ...zero, board: 1000, annual: 2500, practical: 600, monthly: 1200 },
  },
  {
    from_order: 13,
    to_order: 13,
    new: {
      ...zero,
      registration: 200,
      admission: 4000,
      board: 1200,
      practical: 600,
      tbdb: 800,
      monthly: 1200,
    },
    old: { ...zero, board: 1200, annual: 2800, practical: 600, monthly: 1200 },
  },
  {
    from_order: 14,
    to_order: 14,
    new: {
      ...zero,
      registration: 200,
      admission: 4500,
      board: 1000,
      practical: 600,
      practical_alt: 900,
      tbdb: 800,
      monthly: 1400,
    },
    old: { ...zero, board: 1000, annual: 3000, practical: 600, practical_alt: 900, monthly: 1400 },
  },
  {
    from_order: 15,
    to_order: 15,
    new: {
      ...zero,
      registration: 200,
      admission: 5000,
      board: 1500,
      practical: 600,
      practical_alt: 900,
      tbdb: 800,
      monthly: 1400,
    },
    old: { ...zero, board: 1500, annual: 3500, practical: 600, practical_alt: 900, monthly: 1400 },
  },
];

/**
 * "At admission" total as on the printed chart: every one-time charge plus the first
 * month. With `higherPractical`, the higher practical option replaces the normal one.
 */
export function admissionTotal(rate: FeeAmounts, higherPractical = false): number {
  const practical = higherPractical && rate.practical_alt > 0 ? rate.practical_alt : rate.practical;
  return (
    rate.registration +
    rate.admission +
    rate.board +
    rate.annual +
    practical +
    rate.tbdb +
    rate.monthly
  );
}

export interface RateGroup {
  class_ids: number[];
  /** "Nursery to KG 2", "Class 1 to 5", "Class 9" */
  label: string;
  new: FeeAmounts;
  old: FeeAmounts;
}

const amountsOf = (rate: FeeAmounts | undefined): FeeAmounts => {
  const out = emptyAmounts();
  if (rate) for (const key of FEE_KEYS) out[key] = rate[key];
  return out;
};
const same = (a: FeeAmounts, b: FeeAmounts) => FEE_KEYS.every((key) => a[key] === b[key]);

/** Joins neighbouring classes that have exactly the same fees, like the printed chart does. */
export function groupRates(
  rates: FeeRate[],
  classes: { id: number; name: string; sort_order: number }[],
): RateGroup[] {
  const ordered = [...classes].sort((a, b) => a.sort_order - b.sort_order);
  const groups: (RateGroup & { names: string[] })[] = [];
  for (const cls of ordered) {
    const fresh = amountsOf(rates.find((r) => r.class_id === cls.id && r.admission_type === 'new'));
    const old = amountsOf(rates.find((r) => r.class_id === cls.id && r.admission_type === 'old'));
    const last = groups[groups.length - 1];
    if (last && same(last.new, fresh) && same(last.old, old)) {
      last.class_ids.push(cls.id);
      last.names.push(cls.name);
    } else {
      groups.push({ class_ids: [cls.id], names: [cls.name], label: '', new: fresh, old });
    }
  }
  return groups.map(({ names, ...group }) => {
    const first = names[0]!;
    const lastName = names[names.length - 1]!;
    const label =
      names.length === 1
        ? first
        : `${first} to ${lastName.replace(/^Class /, first.startsWith('Class ') ? '' : 'Class ')}`;
    return { ...group, label };
  });
}

// ── Student fees: every money calculation lives below, as pure functions ─────

/** The seven fee types a student is charged. The six one-time charges are cleared first, in this order. */
export const ONE_TIME_TYPES = [
  'registration',
  'admission',
  'board',
  'annual',
  'practical',
  'tbdb',
] as const;
export const CHARGE_TYPES = [...ONE_TIME_TYPES, 'monthly'] as const;
export type ChargeType = (typeof CHARGE_TYPES)[number];
export const CHARGE_LABELS: Record<ChargeType, string> = {
  registration: 'Registration',
  admission: 'Admission',
  board: 'Board fee / registration',
  annual: 'Annual charge',
  practical: 'Practical',
  tbdb: 'TBDB etc.',
  monthly: 'Monthly fee',
};

export const DISCOUNT_TYPES = ['none', 'percent', 'amount'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export interface FeeItem {
  type: ChargeType;
  /** Fee before discount. For the monthly fee this is the amount for one month. */
  amount: number;
  discount_type: DiscountType;
  /** Percent (0-100) or rupees, as entered. */
  discount_value: number;
  /** The resulting discount in rupees (per month for the monthly fee). */
  discount: number;
}
export interface FeePlan {
  items: FeeItem[];
  /** Months the monthly fee is charged for, counted from the start of the session. */
  months: number;
}

/** Rupee value of a discount. Percent discounts round to the nearest rupee; never more than the fee. */
export function computeDiscount(amount: number, type: DiscountType, value: number): number {
  if (type === 'percent') return Math.min(amount, Math.max(0, Math.round((amount * value) / 100)));
  if (type === 'amount') return Math.min(amount, Math.max(0, value));
  return 0;
}

/** A student's fees as copied from the rate chart, before any discount. */
export function itemsFromRate(rate: FeeAmounts, higherPractical = false): FeeItem[] {
  return CHARGE_TYPES.map((type) => ({
    type,
    amount:
      type === 'practical' && higherPractical && rate.practical_alt > 0
        ? rate.practical_alt
        : rate[type],
    discount_type: 'none' as const,
    discount_value: 0,
    discount: 0,
  }));
}

/** Fills in the rupee discount of every item from its type and value. */
export function withDiscounts(items: Omit<FeeItem, 'discount'>[]): FeeItem[] {
  return CHARGE_TYPES.map((type) => {
    const item = items.find((i) => i.type === type);
    const amount = item?.amount ?? 0;
    const discount_type = item?.discount_type ?? 'none';
    const discount_value = discount_type === 'none' ? 0 : (item?.discount_value ?? 0);
    return {
      type,
      amount,
      discount_type,
      discount_value,
      discount: computeDiscount(amount, discount_type, discount_value),
    };
  });
}

export interface PlanTotals {
  one_time_gross: number;
  one_time_net: number;
  /** Per month. */
  monthly_gross: number;
  monthly_net: number;
  /** Whole session. */
  gross: number;
  discount: number;
  net: number;
}

export function planTotals(plan: FeePlan): PlanTotals {
  let one_time_gross = 0;
  let one_time_net = 0;
  let monthly_gross = 0;
  let monthly_net = 0;
  for (const item of plan.items) {
    if (item.type === 'monthly') {
      monthly_gross += item.amount;
      monthly_net += item.amount - item.discount;
    } else {
      one_time_gross += item.amount;
      one_time_net += item.amount - item.discount;
    }
  }
  const gross = one_time_gross + monthly_gross * plan.months;
  const net = one_time_net + monthly_net * plan.months;
  return {
    one_time_gross,
    one_time_net,
    monthly_gross,
    monthly_net,
    gross,
    discount: gross - net,
    net,
  };
}

/** "Due at admission": net one-time charges plus the first month. */
export function dueAtAdmission(plan: FeePlan): number {
  const totals = planTotals(plan);
  return totals.one_time_net + (plan.months > 0 ? totals.monthly_net : 0);
}

/**
 * How many months of the session have started on a date (the current month counts).
 * 0 before the session starts, 12 once it is over.
 */
export function monthsStarted(
  session: { start_year: number; start_month: number },
  today: string,
): number {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const passed = (year - session.start_year) * 12 + (month - session.start_month) + 1;
  return Math.max(0, Math.min(12, passed));
}

export interface FeePosition {
  /** Fee for the session before discounts. */
  fee: number;
  /** Discounts written on the student's fees. */
  discount: number;
  net: number;
  /** Money received (cancelled receipts are not counted). */
  paid: number;
  /** Extra discounts given at the counter. */
  counter_discount: number;
  /** paid + counter discounts: what has been cleared. */
  settled: number;
  /** Still to pay for the whole year. */
  pending: number;
  /** Should have been cleared by today. */
  due_today: number;
  /** Not cleared although due by today. */
  overdue: number;
}

/**
 * Where a student stands. A student who has left owes nothing further: their fee is
 * taken to be exactly what they have settled.
 */
export function feePosition(
  plan: FeePlan,
  money: { paid: number; counter_discount: number },
  started: number,
  left = false,
): FeePosition {
  const totals = planTotals(plan);
  const settled = money.paid + money.counter_discount;
  if (left) {
    return {
      fee: totals.gross,
      discount: totals.discount,
      net: settled,
      paid: money.paid,
      counter_discount: money.counter_discount,
      settled,
      pending: 0,
      due_today: settled,
      overdue: 0,
    };
  }
  const due_today = totals.one_time_net + totals.monthly_net * Math.min(plan.months, started);
  return {
    fee: totals.gross,
    discount: totals.discount,
    net: totals.net,
    paid: money.paid,
    counter_discount: money.counter_discount,
    settled,
    pending: Math.max(0, totals.net - settled),
    due_today,
    overdue: Math.max(0, due_today - settled),
  };
}

export type MonthStatus = 'paid' | 'part' | 'due' | 'upcoming' | 'waived';
export interface Allocation {
  one_time: {
    type: ChargeType;
    amount: number;
    discount: number;
    net: number;
    paid: number;
    balance: number;
  }[];
  months: {
    index: number;
    year: number;
    month: number;
    net: number;
    paid: number;
    status: MonthStatus;
  }[];
}

/**
 * Spreads what has been settled over the charges, oldest first: the one-time charges in
 * order, then the months from the start of the session.
 */
export function allocate(
  plan: FeePlan,
  settled: number,
  session: { start_year: number; start_month: number },
  started: number,
  left = false,
): Allocation {
  let remaining = settled;
  const take = (net: number) => {
    const paid = Math.min(net, remaining);
    remaining -= paid;
    return paid;
  };
  const one_time = plan.items
    .filter((i) => i.type !== 'monthly' && i.amount > 0)
    .map((i) => {
      const net = i.amount - i.discount;
      const paid = take(net);
      return {
        type: i.type,
        amount: i.amount,
        discount: i.discount,
        net,
        paid,
        balance: left ? 0 : net - paid,
      };
    });
  const monthlyNet = planTotals(plan).monthly_net;
  const months = Array.from({ length: 12 }, (_, index) => {
    const m = session.start_month - 1 + index;
    const year = session.start_year + Math.floor(m / 12);
    const month = (m % 12) + 1;
    const charged = index < plan.months && monthlyNet > 0;
    const paid = charged ? take(monthlyNet) : 0;
    let status: MonthStatus;
    if (!charged) status = 'waived';
    else if (paid >= monthlyNet) status = 'paid';
    else if (left) status = 'waived';
    else if (paid > 0) status = 'part';
    else status = index < started ? 'due' : 'upcoming';
    return { index, year, month, net: charged ? monthlyNet : 0, paid, status };
  });
  return { one_time, months };
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * What one receipt cleared, in words for the receipt: the slice of charges between what
 * was settled before it and after it. Example: "Admission, TBDB etc., April to June, July (part)".
 */
export function receiptCovers(
  plan: FeePlan,
  settledBefore: number,
  settledNow: number,
  session: { start_year: number; start_month: number },
): string {
  const before = allocate(plan, settledBefore, session, 12);
  const after = allocate(plan, settledBefore + settledNow, session, 12);
  const parts: string[] = [];
  after.one_time.forEach((charge, i) => {
    const got = charge.paid - (before.one_time[i]?.paid ?? 0);
    if (got > 0)
      parts.push(CHARGE_LABELS[charge.type] + (charge.paid < charge.net ? ' (part)' : ''));
  });
  const touched = after.months.filter((m, i) => m.paid - (before.months[i]?.paid ?? 0) > 0);
  const full = touched.filter((m) => m.paid >= m.net);
  const name = (m: { month: number }) => MONTH_NAMES[m.month - 1]!;
  if (full.length === 1) parts.push(name(full[0]!));
  if (full.length > 1) parts.push(`${name(full[0]!)} to ${name(full[full.length - 1]!)}`);
  for (const m of touched) if (m.paid < m.net) parts.push(`${name(m)} (part)`);
  return parts.join(', ');
}

/** Amounts for the quick buttons on the collect screen. */
export function quickAmounts(
  plan: FeePlan,
  position: FeePosition,
): { due_today: number; one_month: number; full: number } {
  const monthly = planTotals(plan).monthly_net;
  return {
    due_today: position.overdue,
    one_month: Math.min(position.pending, monthly > 0 ? monthly : position.pending),
    full: position.pending,
  };
}

const ONES = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const below100 = (n: number): string =>
  n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
const below1000 = (n: number): string => {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} hundred` : '', rest ? below100(rest) : '']
    .filter(Boolean)
    .join(' ');
};

/** 290075 → "Two lakh ninety thousand seventy five rupees only" (Indian system). */
export function amountInWords(amount: number): string {
  if (!Number.isInteger(amount) || amount < 0) throw new Error('Money must be whole rupees');
  if (amount === 0) return 'Zero rupees only';
  const crore = Math.floor(amount / 10_000_000);
  const lakh = Math.floor((amount % 10_000_000) / 100_000);
  const thousand = Math.floor((amount % 100_000) / 1000);
  const rest = amount % 1000;
  const words = [
    crore ? `${below1000(crore)} crore` : '',
    lakh ? `${below100(lakh)} lakh` : '',
    thousand ? `${below100(thousand)} thousand` : '',
    rest ? below1000(rest) : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `${words[0]!.toUpperCase()}${words.slice(1)} ${amount === 1 ? 'rupee' : 'rupees'} only`;
}

export const PAYMENT_MODES = ['cash', 'upi', 'bank', 'cheque'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export const MODE_LABELS: Record<PaymentMode, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank: 'Bank',
  cheque: 'Cheque',
};
