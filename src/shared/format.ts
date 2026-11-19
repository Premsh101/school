/** Whole rupees with Indian grouping: 290075 → ₹2,90,075. Money is always an integer. */
export function formatINR(amount: number): string {
  if (!Number.isInteger(amount)) throw new Error('Money must be whole rupees');
  const sign = amount < 0 ? '-' : '';
  const digits = String(Math.abs(amount));
  if (digits.length <= 3) return `${sign}₹${digits}`;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}₹${rest},${last3}`;
}
