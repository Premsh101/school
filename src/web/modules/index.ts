import type { ComponentType } from 'react';
import { feesWebModule } from './fees';

/**
 * What every feature module (fees, attendance, lectures, leave) gives the web shell.
 * The shell builds navigation, routes and the home page from this list, so adding a
 * module never means editing shell code.
 */
export interface WebModule {
  id: string;
  name: string;
  icon: string;
  /** Pages, mounted under /<id>/<path>. */
  routes: { path: string; component: ComponentType; permission?: string }[];
  /** `group` says where the entry sits in the menu; 'main' also puts it in the phone's bottom bar. */
  navItems: {
    to: string;
    label: string;
    icon: string;
    permission?: string;
    group?: 'main' | 'school' | 'admin';
  }[];
  permissions: string[];
  /** Cards shown on the home page. */
  dashboardWidgets: { id: string; component: ComponentType; permission?: string }[];
}

/** Add modules here as they are built. */
export const webModules: WebModule[] = [feesWebModule];
