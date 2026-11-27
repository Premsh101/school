import { z } from 'zod';
import { isValidDate } from '../../../shared/dates';
import { CHARGE_TYPES, DISCOUNT_TYPES, PAYMENT_MODES } from '../../../shared/fees';

const id = z.number().int().positive();
const rupees = z
  .number()
  .int('Use whole rupees, no paise')
  .min(0, 'Amount cannot be less than 0')
  .max(1_000_000, 'Amount is too large');

const amounts = z.object({
  registration: rupees,
  admission: rupees,
  board: rupees,
  annual: rupees,
  practical: rupees,
  practical_alt: rupees,
  tbdb: rupees,
  monthly: rupees,
});

export const ratesInput = z.object({
  session_id: id,
  branch_ids: z.array(id).min(1, 'Choose at least one branch').max(50),
  class_ids: z.array(id).min(1, 'Choose at least one class').max(30),
  new: amounts,
  old: amounts,
});

export const ratesStartInput = z.object({ session_id: id });

export const studentFeesInput = z.object({
  /** The transport route (source to destination) the student uses, or null for none. */
  transport_route_id: id.nullable().default(null),
  months: z.number().int().min(0, 'Months must be 0 to 12').max(12, 'Months must be 0 to 12'),
  discount_reason: z.string().trim().max(100).default(''),
  items: z
    .array(
      z.object({
        type: z.enum(CHARGE_TYPES),
        amount: rupees,
        discount_type: z.enum(DISCOUNT_TYPES),
        discount_value: z.number().int('Use a whole number').min(0).max(1_000_000),
      }),
    )
    .max(CHARGE_TYPES.length),
});

export const receiptInput = z.object({
  enrolment_id: id,
  date: z.string().refine(isValidDate, 'Enter a real date'),
  /**
   * With discount_basis 'payment': how much of the student's dues this receipt clears, before
   * the discount, which comes out of it. With 'total': the money taken for fees, on top of a
   * discount worked out on the student's total pending fees.
   */
  settle_amount: rupees,
  discount_basis: z.enum(['payment', 'total']).default('payment'),
  /** Late fee taken with this receipt (never more than what is owed). */
  late_fee: rupees.default(0),
  /** Waive the late fee owed instead of taking it (admin and management only). */
  waive_late_fee: z.boolean().default(false),
  counter_discount_type: z.enum(DISCOUNT_TYPES).default('none'),
  counter_discount_value: z.number().int('Use a whole number').min(0).max(1_000_000).default(0),
  mode: z.enum(PAYMENT_MODES),
  reference: z.string().trim().max(60).default(''),
  note: z.string().trim().max(200).default(''),
});

export const cancelInput = z.object({
  reason: z.string().trim().min(3, 'Write why the receipt is being cancelled').max(200),
});

export const lateFeeWaiverInput = z.object({
  /** Leave out to waive everything that is owed. */
  amount: rupees.min(1, 'Enter an amount more than 0').optional(),
  reason: z.string().trim().min(3, 'Write why the late fee is waived').max(200),
});

export const transportRouteInput = z.object({
  branch_id: id,
  source: z.string().trim().min(1, 'Enter where the route starts').max(60),
  destination: z.string().trim().min(1, 'Enter where the route ends').max(60),
  monthly_fee: rupees,
  active: z.boolean().default(true),
});
