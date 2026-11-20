import type { WorkerModule } from '../index';
import { FEES_PERMISSIONS, FEES_ROLE_PERMISSIONS } from './permissions';
import { routes } from './routes';
import { afterEnrolments, ensureRates } from './service';

export const feesModule: WorkerModule = {
  id: 'fees',
  name: 'Fees',
  routes,
  permissions: FEES_PERMISSIONS,
  rolePermissions: FEES_ROLE_PERMISSIONS,
  backupTables: ['fee_rates', 'student_fees', 'receipts'],
  // A new session starts with each branch's previous chart (or the printed one).
  onSessionOpened: (c, _from, to) =>
    ensureRates(
      c.env.DB,
      '(SELECT id FROM academic_sessions WHERE start_year = ?1)',
      to.start_year,
    ),
  // New students get their fees copied from the chart straight away.
  onEnrolmentsAdded: (c, sessionId) => afterEnrolments(c.env.DB, sessionId),
};
