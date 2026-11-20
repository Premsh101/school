// Roles are fixed sets of permissions. Modules add their own permissions to roles
// (for example 'fees.collect') through their manifest.
//
//   admin       everything, in every school; the only role that creates logins
//   management  the daily work of every school: students, staff, promotion, fees
//   accountant  fees in the schools they are assigned to

export const ROLES = ['admin', 'management', 'accountant'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  management: 'Management',
  accountant: 'Accountant',
};

export const ROLE_HINTS: Record<Role, string> = {
  admin: 'Everything in every school, including logins and settings',
  management: 'Students, staff and fees in every school',
  accountant: 'Fees in the schools you tick below',
};

export const CORE_PERMISSIONS = [
  'students.view',
  'students.edit',
  'students.import',
  'students.promote',
  'staff.view',
  'staff.edit',
  'structure.edit', // sections
  'users.manage', // logins: admin only
  'school.manage', // branches, sessions, subjects, settings, modules
  'audit.view',
  'backup.manage',
] as const;
export type CorePermission = (typeof CORE_PERMISSIONS)[number];
export type Permission = CorePermission | (string & {});

const ROLE_PERMISSIONS: Record<Role, readonly Permission[] | '*'> = {
  admin: '*',
  management: [
    'students.view',
    'students.edit',
    'students.import',
    'students.promote',
    'staff.view',
    'staff.edit',
    'structure.edit',
  ],
  accountant: ['students.view'],
};

/** Extra permissions granted to roles by modules, e.g. fees → accountant. */
const modulePermissions: Partial<Record<Role, Permission[]>> = {};

export function grantModulePermissions(role: Role, permissions: Permission[]): void {
  modulePermissions[role] = [...(modulePermissions[role] ?? []), ...permissions];
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function can(role: Role, permission: Permission): boolean {
  if (!isRole(role)) return false;
  const own = ROLE_PERMISSIONS[role];
  if (own === '*') return true;
  return own.includes(permission) || (modulePermissions[role] ?? []).includes(permission);
}

/** Admin and management work in every school; an accountant only in their assigned schools. */
export function seesAllBranches(role: Role): boolean {
  return role === 'admin' || role === 'management';
}
