import type { WebModule } from '../index';
import { RateChartPage } from './RateChart';

export const feesWebModule: WebModule = {
  id: 'fees',
  name: 'Fees',
  icon: 'rupee',
  routes: [{ path: 'rates', component: RateChartPage, permission: 'fees.view' }],
  navItems: [
    {
      to: '/fees/rates',
      label: 'Fee rate chart',
      icon: 'rupee',
      permission: 'fees.view',
      group: 'school',
    },
  ],
  permissions: ['fees.view', 'fees.rates.edit'],
  dashboardWidgets: [],
};
