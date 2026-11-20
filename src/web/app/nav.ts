import { webModules } from '../modules';
import { t } from './i18n';

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  permission?: string;
  group: 'main' | 'school' | 'admin' | 'me';
}

/** Core navigation plus whatever the switched-on modules add. */
export function navItems(
  can: (permission: string) => boolean,
  modulesOn: Record<string, boolean>,
): NavItem[] {
  const core: NavItem[] = [
    { to: '/', label: t('Home'), icon: 'home', group: 'main' },
    {
      to: '/students',
      label: t('Students'),
      icon: 'students',
      permission: 'students.view',
      group: 'main',
    },
    { to: '/staff', label: t('Staff'), icon: 'staff', permission: 'staff.view', group: 'main' },
    {
      to: '/reports',
      label: t('Reports'),
      icon: 'report',
      permission: 'students.view',
      group: 'main',
    },
    {
      to: '/students/import',
      label: t('Import students'),
      icon: 'upload',
      permission: 'students.import',
      group: 'school',
    },
    {
      to: '/promotion',
      label: t('Promote to next session'),
      icon: 'promote',
      permission: 'students.promote',
      group: 'school',
    },
    {
      to: '/classes',
      label: t('Classes and sections'),
      icon: 'classes',
      permission: 'structure.edit',
      group: 'school',
    },
    { to: '/users', label: t('Logins'), icon: 'users', permission: 'users.manage', group: 'admin' },
    {
      to: '/branches',
      label: t('Branches'),
      icon: 'branch',
      permission: 'school.manage',
      group: 'admin',
    },
    {
      to: '/sessions',
      label: t('Sessions'),
      icon: 'calendar',
      permission: 'school.manage',
      group: 'admin',
    },
    {
      to: '/settings',
      label: t('Settings'),
      icon: 'settings',
      permission: 'school.manage',
      group: 'admin',
    },
    {
      to: '/audit',
      label: t('Activity log'),
      icon: 'audit',
      permission: 'audit.view',
      group: 'admin',
    },
    {
      to: '/backup',
      label: t('Backup'),
      icon: 'backup',
      permission: 'backup.manage',
      group: 'admin',
    },
    { to: '/account', label: t('My account'), icon: 'account', group: 'me' },
  ];
  const fromModules: NavItem[] = webModules
    .filter((m) => modulesOn[m.id] !== false)
    .flatMap((m) =>
      m.navItems.map((item) => ({
        ...item,
        label: t(item.label),
        group: item.group ?? ('main' as const),
      })),
    );
  // Module entries come first inside their group (after Home in the main group).
  const merged = [...core.slice(0, 1), ...fromModules, ...core.slice(1)];
  const order: NavItem['group'][] = ['main', 'school', 'admin', 'me'];
  return order
    .flatMap((g) => merged.filter((item) => item.group === g))
    .filter((item) => !item.permission || can(item.permission));
}

export const GROUP_TITLES: Record<NavItem['group'], string> = {
  main: '',
  school: 'School work',
  admin: 'Admin',
  me: 'You',
};
