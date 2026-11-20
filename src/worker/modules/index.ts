import type { Hono } from 'hono';
import type { Permission, Role } from '../../shared/permissions';
import type { AppEnv, Ctx } from '../env';

/**
 * What every feature module (fees, attendance, lectures, leave) gives the core.
 * The core mounts its routes under /api/<id>, includes its tables in backups, and
 * calls its hooks, so modules plug in without changes to core code.
 */
export interface WorkerModule {
  id: string;
  name: string;
  routes: Hono<AppEnv>;
  permissions: Permission[];
  /** Which roles get which of the module's permissions (admin always has all). */
  rolePermissions: Partial<Record<Role, Permission[]>>;
  /** Tables owned by the module, parents before children, for backup and restore. */
  backupTables: string[];
  /** Extra statements to run when a new academic session is opened (e.g. copy the fee chart). */
  onSessionOpened?: (
    c: Ctx,
    from: { id: number } | null,
    to: { start_year: number },
  ) => D1PreparedStatement[];
  /** Extra statements to run in the same batch that adds enrolments to a session (e.g. copy their fees). */
  onEnrolmentsAdded?: (c: Ctx, sessionId: number) => D1PreparedStatement[];
}

/** Add modules here as they are built. */
export const modules: WorkerModule[] = [];

/** Called once by the app entry, which avoids modules and this file importing each other in a loop. */
export function registerModules(list: WorkerModule[]): void {
  modules.push(...list);
}

/** Statements from every module for enrolments just added to a session. */
export const enrolmentHooks = (c: Ctx, sessionId: number): D1PreparedStatement[] =>
  modules.flatMap((m) => m.onEnrolmentsAdded?.(c, sessionId) ?? []);
