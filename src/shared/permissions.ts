// Roles are fixed sets of permissions. Modules add their own permissions to this map
// (for example 'fees.collect') when they are built.

export const ROLES = ['admin', 'principal', 'accountant', 'teacher', 'staff'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Owner / Admin',
  principal: 'Principal',
  accountant: 'Accountant',
  teacher: 'Teacher',
  staff: 'Staff',
};

export const CORE_PERMISSIONS = [
  'students.view',
  'students.edit',
  'students.import',
  'students.promote',
  'staff.view',
  'staff.edit',
  'structure.edit', // sections of own branches
  'users.manage', // principals manage accountants, teachers and staff of own branches
  'school.manage', // branches, sessions, subjects, settings, modules
  'audit.view',
  'backup.manage',
] as const;
export type CorePermission = (typeof CORE_PERMISSIONS)[number];
export type Permission = CorePermission | (string & {});

const ROLE_PERMISSIONS: Record<Role, readonly Permission[] | '*'> = {
  admin: '*',
  principal: [
    'students.view',
    'students.edit',
    'students.import',
    'students.promote',
    'staff.view',
    'staff.edit',
    'structure.edit',
    'users.manage',
  ],
  accountant: ['students.view'],
  teacher: ['students.view'],
  staff: [],
};

/** Extra permissions granted to roles by modules, e.g. fees → accountant. */
const modulePermissions: Partial<Record<Role, Permission[]>> = {};

export function grantModulePermissions(role: Role, permissions: Permission[]): void {
  modulePermissions[role] = [...(modulePermissions[role] ?? []), ...permissions];
}

export function can(role: Role, permission: Permission): boolean {
  const own = ROLE_PERMISSIONS[role];
  if (own === '*') return true;
  return own.includes(permission) || (modulePermissions[role] ?? []).includes(permission);
}

/** Admins see every branch; everyone else only the branches they are assigned to. */
export function seesAllBranches(role: Role): boolean {
  return role === 'admin';
}

/** Roles a user with this role may create or edit. */
export function manageableRoles(role: Role): Role[] {
  if (role === 'admin') return [...ROLES];
  if (role === 'principal') return ['accountant', 'teacher', 'staff'];
  return [];
}
