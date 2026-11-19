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
