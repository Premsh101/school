import type { Permission, Role } from '../../../shared/permissions';

export const FEES_PERMISSIONS: Permission[] = [
  'fees.view', // dashboard, reports, student fee pages, rate chart
  'fees.collect', // take payments and print receipts
  'fees.edit', // a student's fees and discounts
  'fees.cancel', // cancel a receipt
  'fees.rates.edit', // the rate chart and transport routes
  'fees.waive', // waive a late fee
];

/** The admin has every permission. Accountants work the counter; only admin and management cancel a receipt or waive a late fee. */
export const FEES_ROLE_PERMISSIONS: Partial<Record<Role, Permission[]>> = {
  management: ['fees.view', 'fees.collect', 'fees.edit', 'fees.cancel', 'fees.waive'],
  accountant: ['fees.view', 'fees.collect', 'fees.edit'],
};
