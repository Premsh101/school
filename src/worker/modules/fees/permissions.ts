import type { Permission, Role } from '../../../shared/permissions';

export const FEES_PERMISSIONS: Permission[] = [
  'fees.view', // dashboard, reports, student fee pages, rate chart
  'fees.collect', // take payments and print receipts
  'fees.edit', // a student's fees and discounts
  'fees.cancel', // cancel a receipt
  'fees.rates.edit', // the rate chart
];

/** The admin has every permission. Accountants work the counter; only admin and management cancel a receipt. */
export const FEES_ROLE_PERMISSIONS: Partial<Record<Role, Permission[]>> = {
  management: ['fees.view', 'fees.collect', 'fees.edit', 'fees.cancel'],
  accountant: ['fees.view', 'fees.collect', 'fees.edit'],
};
