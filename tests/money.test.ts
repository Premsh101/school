import { describe, expect, it } from 'vitest';
import {
  allocate,
  amountInWords,
  computeDiscount,
  DEFAULT_RATE_CHART,
  dueAtAdmission,
  feePosition,
  itemsFromRate,
  monthsStarted,
  planTotals,
  quickAmounts,
  receiptCovers,
  withDiscounts,
  type FeePlan,
} from '../src/shared/fees';

const session = { start_year: 2026, start_month: 4 };
const class9new = DEFAULT_RATE_CHART[3]!.new; // reg 200, adm 3500, board 1000, practical 600, tbdb 700, monthly 1200
const class11old = DEFAULT_RATE_CHART[5]!.old; // board 1000, annual 3000, practical 600/900, monthly 1400
const plan = (rate = class9new, months = 12, higher = false): FeePlan => ({
  items: itemsFromRate(rate, higher),
  months,
});

describe('discounts', () => {
  it('computes percent and rupee discounts, never more than the fee', () => {
    expect(computeDiscount(1200, 'percent', 10)).toBe(120);
    expect(computeDiscount(700, 'percent', 15)).toBe(105);
    expect(computeDiscount(799, 'percent', 50)).toBe(400); // 399.5 rounds up
    expect(computeDiscount(333, 'percent', 10)).toBe(33); // 33.3 rounds down
    expect(computeDiscount(1200, 'percent', 100)).toBe(1200);
    expect(computeDiscount(1200, 'percent', 150)).toBe(1200);
    expect(computeDiscount(1200, 'amount', 200)).toBe(200);
    expect(computeDiscount(1200, 'amount', 5000)).toBe(1200);
    expect(computeDiscount(1200, 'amount', -5)).toBe(0);
    expect(computeDiscount(1200, 'none', 500)).toBe(0);
  });
  it('applies a discount per fee type; the monthly discount applies to every month', () => {
    const items = withDiscounts([
      ...itemsFromRate(class9new).filter((i) => i.type !== 'admission' && i.type !== 'monthly'),
      { type: 'admission', amount: 3500, discount_type: 'amount', discount_value: 500 },
      { type: 'monthly', amount: 1200, discount_type: 'percent', discount_value: 25 },
    ]);
    const totals = planTotals({ items, months: 12 });
    expect(totals.one_time_gross).toBe(6000);
    expect(totals.one_time_net).toBe(5500);
    expect(totals.monthly_net).toBe(900);
    expect(totals.gross).toBe(6000 + 1200 * 12);
    expect(totals.net).toBe(5500 + 900 * 12);
    expect(totals.discount).toBe(500 + 300 * 12);
    expect(dueAtAdmission({ items, months: 12 })).toBe(6400);
  });
});

describe('fee for the session', () => {
  it('is each one-time charge plus monthly fee × months', () => {
    expect(planTotals(plan()).net).toBe(200 + 3500 + 1000 + 600 + 700 + 1200 * 12);
    expect(planTotals(plan(class9new, 10)).net).toBe(6000 + 1200 * 10);
    expect(dueAtAdmission(plan())).toBe(7200); // as printed on the chart
  });
  it('lets Class 11 and 12 choose the 600 or 900 practical', () => {
    expect(planTotals(plan(class11old)).one_time_net).toBe(1000 + 3000 + 600);
    expect(planTotals(plan(class11old, 12, true)).one_time_net).toBe(1000 + 3000 + 900);
    expect(planTotals(plan(class9new, 12, true)).one_time_net).toBe(6000); // no higher option in Class 9
  });
});

describe('months started', () => {
  it('counts the current month, from the session start', () => {
    expect(monthsStarted(session, '2026-03-31')).toBe(0);
    expect(monthsStarted(session, '2026-04-01')).toBe(1);
    expect(monthsStarted(session, '2026-11-19')).toBe(8);
    expect(monthsStarted(session, '2027-01-05')).toBe(10);
    expect(monthsStarted(session, '2027-03-31')).toBe(12);
    expect(monthsStarted(session, '2027-08-01')).toBe(12);
    expect(monthsStarted({ start_year: 2026, start_month: 7 }, '2026-07-15')).toBe(1);
  });
});

describe('due today, pending, overdue', () => {
  const p = plan(); // one-time 6000, monthly 1200
  it('with nothing paid', () => {
    const pos = feePosition(p, { paid: 0, counter_discount: 0 }, 8);
    expect(pos.due_today).toBe(6000 + 1200 * 8);
    expect(pos.pending).toBe(6000 + 1200 * 12);
    expect(pos.overdue).toBe(15600);
  });
  it('counter discounts settle dues like payments', () => {
    const pos = feePosition(p, { paid: 15000, counter_discount: 600 }, 8);
    expect(pos.settled).toBe(15600);
    expect(pos.overdue).toBe(0);
    expect(pos.pending).toBe(20400 - 15600);
  });
  it('paying ahead leaves nothing overdue, and nothing goes negative', () => {
    const ahead = feePosition(p, { paid: 20400, counter_discount: 0 }, 2);
    expect(ahead).toMatchObject({ pending: 0, overdue: 0, due_today: 8400 });
  });
  it('months fewer than 12 cap what is due', () => {
    const pos = feePosition(plan(class9new, 10), { paid: 0, counter_discount: 0 }, 12);
    expect(pos.due_today).toBe(6000 + 1200 * 10);
    expect(pos.pending).toBe(pos.due_today);
  });
  it('a student who left owes nothing further; what they paid stays', () => {
    const pos = feePosition(p, { paid: 7200, counter_discount: 0 }, 8, true);
    expect(pos).toMatchObject({ paid: 7200, net: 7200, pending: 0, overdue: 0 });
  });
  it('quick buttons: due today, one month, full', () => {
    const pos = feePosition(p, { paid: 7200, counter_discount: 0 }, 3);
    expect(quickAmounts(p, pos)).toEqual({ due_today: 2400, one_month: 1200, full: 13200 });
    const nearlyDone = feePosition(p, { paid: 20000, counter_discount: 0 }, 12);
    expect(quickAmounts(p, nearlyDone)).toEqual({ due_today: 400, one_month: 400, full: 400 });
  });
});

describe('oldest-first allocation', () => {
  const p = plan();
  it('clears one-time charges in order, then April, May, …', () => {
    const a = allocate(p, 200 + 3500 + 500, session, 8);
    expect(a.one_time.map((c) => [c.type, c.paid, c.balance])).toEqual([
      ['registration', 200, 0],
      ['admission', 3500, 0],
      ['board', 500, 500],
      ['practical', 0, 600],
      ['tbdb', 0, 700],
    ]);
    expect(a.months.every((m) => m.paid === 0)).toBe(true);
  });
  it('marks months as paid, part paid, due, upcoming', () => {
    const a = allocate(p, 6000 + 1200 * 2 + 500, session, 5);
    expect(a.months.map((m) => m.status)).toEqual([
      'paid',
      'paid',
      'part',
      'due',
      'due',
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
    expect(a.months[0]).toMatchObject({ year: 2026, month: 4 });
    expect(a.months[9]).toMatchObject({ year: 2027, month: 1 });
    expect(a.months[2]).toMatchObject({ paid: 500, net: 1200 });
  });
  it('marks months beyond the charged months, or with a 100% discount, as waived', () => {
    const ten = allocate(plan(class9new, 10), 0, session, 12);
    expect(ten.months.slice(10).map((m) => m.status)).toEqual(['waived', 'waived']);
    expect(ten.months[9]!.status).toBe('due');
    const free = allocate(
      {
        items: withDiscounts(
          itemsFromRate(class9new).map((i) =>
            i.type === 'monthly' ? { ...i, discount_type: 'percent', discount_value: 100 } : i,
          ),
        ),
        months: 12,
      },
      0,
      session,
      12,
    );
    expect(free.months.every((m) => m.status === 'waived')).toBe(true);
  });
  it('after a cancellation the balance simply recalculates', () => {
    const before = allocate(p, 6000 + 2400, session, 8);
    const afterCancel = allocate(p, 6000, session, 8); // the 2,400 receipt was cancelled
    expect(before.months.slice(0, 3).map((m) => m.status)).toEqual(['paid', 'paid', 'due']);
    expect(afterCancel.months.slice(0, 3).map((m) => m.status)).toEqual(['due', 'due', 'due']);
    expect(feePosition(p, { paid: 6000, counter_discount: 0 }, 8).overdue).toBe(9600);
  });
  it('unpaid months of a student who left are waived', () => {
    const a = allocate(p, 6000 + 1200, session, 8, true);
    expect(a.months.map((m) => m.status).slice(0, 3)).toEqual(['paid', 'waived', 'waived']);
    expect(a.one_time.every((c) => c.balance === 0)).toBe(true);
  });
});

describe('what a receipt covers', () => {
  const p = plan();
  it('names the charges and months a payment cleared', () => {
    expect(receiptCovers(p, 0, 7200, session)).toBe(
      'Registration, Admission, Board fee / registration, Practical, TBDB etc., April',
    );
    expect(receiptCovers(p, 7200, 3600, session)).toBe('May to July');
    expect(receiptCovers(p, 10800, 1700, session)).toBe('August, September (part)');
    expect(receiptCovers(p, 12500, 700, session)).toBe('September');
    expect(receiptCovers(p, 0, 3000, session)).toBe('Registration, Admission (part)');
  });
});

describe('amount in words (Indian system)', () => {
  it('writes rupees in words', () => {
    expect(amountInWords(0)).toBe('Zero rupees only');
    expect(amountInWords(1)).toBe('One rupee only');
    expect(amountInWords(15)).toBe('Fifteen rupees only');
    expect(amountInWords(700)).toBe('Seven hundred rupees only');
    expect(amountInWords(7200)).toBe('Seven thousand two hundred rupees only');
    expect(amountInWords(10001)).toBe('Ten thousand one rupees only');
    expect(amountInWords(290075)).toBe('Two lakh ninety thousand seventy five rupees only');
    expect(amountInWords(10000000)).toBe('One crore rupees only');
    expect(amountInWords(12345678)).toBe(
      'One crore twenty three lakh forty five thousand six hundred seventy eight rupees only',
    );
    expect(() => amountInWords(10.5)).toThrow();
  });
});
