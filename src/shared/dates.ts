// All dates are stored as YYYY-MM-DD in India time (Asia/Kolkata, UTC+5:30, no DST).

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function todayIST(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** '2026-27' for a session starting in 2026. */
export function sessionName(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** The start year of the session a date falls in, e.g. 2027-02-10 with April start → 2026. */
export function sessionStartYearFor(date: string, startMonth = 4): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month >= startMonth ? year : year - 1;
}

/** The 12 months of a session in order, as { year, month } with month 1-12. */
export function sessionMonths(
  startYear: number,
  startMonth = 4,
): { year: number; month: number }[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = startMonth - 1 + i;
    return { year: startYear + Math.floor(m / 12), month: (m % 12) + 1 };
  });
}

/** 2026-11-19 → 19 Nov 2026 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const [y, m, d] = value.slice(0, 10).split('-');
  return `${Number(d)} ${months[Number(m) - 1] ?? ''} ${y}`;
}

/**
 * Accepts the date styles office staff type in spreadsheets (2015-08-23, 23/08/2015,
 * 23-08-2015, 23.08.15) and returns YYYY-MM-DD, or null if it is not a real date.
 */
export function parseLooseDate(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += y > 50 ? 1900 : 2000;
  }
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidDate(iso) ? iso : null;
}
