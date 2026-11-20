import type { WebModule } from '../index';
import './fees.css';
import { CollectPage } from './Collect';
import { DashboardPage, FeesHomeWidget } from './Dashboard';
import { EditFeesPage } from './EditFees';
import { RateChartPage } from './RateChart';
import { ReceiptPage } from './Receipt';
import { ReportsPage } from './Reports';
import { StudentFeesPage } from './StudentFees';

export const feesWebModule: WebModule = {
  id: 'fees',
  name: 'Fees',
  icon: 'rupee',
  routes: [
    { path: '', component: DashboardPage, permission: 'fees.view' },
    { path: 'collect', component: CollectPage, permission: 'fees.collect' },
    { path: 'student/:id', component: StudentFeesPage, permission: 'fees.view' },
    { path: 'student/:id/edit', component: EditFeesPage, permission: 'fees.edit' },
    { path: 'receipt/:id', component: ReceiptPage, permission: 'fees.view' },
    { path: 'reports', component: ReportsPage, permission: 'fees.view' },
    { path: 'rates', component: RateChartPage, permission: 'fees.view' },
  ],
  navItems: [
    { to: '/fees', label: 'Fees', icon: 'rupee', permission: 'fees.view' },
    { to: '/fees/collect', label: 'Collect fee', icon: 'collect', permission: 'fees.collect' },
    {
      to: '/fees/reports',
      label: 'Fee reports',
      icon: 'audit',
      permission: 'fees.view',
      group: 'school',
    },
    {
      to: '/fees/rates',
      label: 'Fee rate chart',
      icon: 'classes',
      permission: 'fees.view',
      group: 'school',
    },
  ],
  permissions: ['fees.view', 'fees.collect', 'fees.edit', 'fees.cancel', 'fees.rates.edit'],
  dashboardWidgets: [{ id: 'fees-summary', component: FeesHomeWidget, permission: 'fees.view' }],
  studentLinks: [
    { to: (enrolmentId) => `/fees/student/${enrolmentId}`, label: 'Fees', permission: 'fees.view' },
  ],
};
