import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { can, isRole, seesAllBranches, type Permission, type Role } from '../../shared/permissions';
import type { AppEnv, AuthUser, Ctx } from '../env';
import { AppError } from './errors';
import { newToken, sha256 } from './password';

const COOKIE = 'sid';
const SESSION_DAYS = 30;
const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Creates a sign-in session for the chosen school (null = all schools) and sets the cookie.
 * Returns the statement to run.
 */
export async function startSession(
  c: Ctx,
  userId: number,
  branchId: number | null,
): Promise<D1PreparedStatement> {
  const token = newToken();
  const now = nowSeconds();
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    // Secure everywhere except plain-http local development.
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge,
  });
  return c.env.DB.prepare(
    'INSERT INTO auth_sessions (token_hash, user_id, branch_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(await sha256(token), userId, branchId, now, now + maxAge);
}

export function clearSessionCookie(c: Ctx): void {
  deleteCookie(c, COOKIE, { path: '/' });
}

/**
 * Checks that a person may work in the chosen school and returns an error message if not.
 * null = all schools, which only admin and management may choose.
 */
export function schoolChoiceProblem(
  role: Role,
  assigned: number[],
  branchId: number | null,
): string | null {
  if (branchId === null) {
    return seesAllBranches(role) ? null : 'Choose your school from the list.';
  }
  if (seesAllBranches(role) || assigned.includes(branchId)) return null;
  return 'You are not assigned to this school. Choose your own school, or ask the admin.';
}

/** Looks up the signed-in user from the cookie (one query). Null if not signed in. */
export async function currentUser(c: Ctx): Promise<AuthUser | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.name, u.role, u.must_change_password, s.id AS session_id,
            s.branch_id AS session_branch_id,
            (SELECT active FROM branches WHERE id = s.branch_id) AS branch_active,
            (SELECT group_concat(branch_id) FROM user_branches WHERE user_id = u.id) AS branch_ids
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
  )
    .bind(await sha256(token), nowSeconds())
    .first<{
      id: number;
      username: string;
      name: string;
      role: string;
      must_change_password: number;
      session_id: number;
      session_branch_id: number | null;
      branch_active: number | null;
      branch_ids: string | null;
    }>();
  if (!row || !isRole(row.role)) return null;
  const assigned = row.branch_ids ? row.branch_ids.split(',').map(Number) : [];
  // If the person lost access to the chosen school since signing in, or the school was
  // closed, the session no longer counts: they sign in again and choose.
  if (schoolChoiceProblem(row.role, assigned, row.session_branch_id)) return null;
  if (row.session_branch_id !== null && row.branch_active !== 1) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    assigned_branch_ids: assigned,
    session_branch_id: row.session_branch_id,
    scope: row.session_branch_id === null ? null : [row.session_branch_id],
    must_change_password: row.must_change_password === 1,
    session_id: row.session_id,
  };
}

/**
 * Every route below this middleware needs a signed-in user. Someone who still has to set
 * a new password can do nothing else until they have.
 */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const user = await currentUser(c);
  if (!user) throw new AppError(401, 'Please sign in again.');
  if (user.must_change_password && !c.req.path.endsWith('/auth/password')) {
    throw new AppError(403, 'Set a new password first.');
  }
  c.set('user', user);
  await next();
});

export const requirePermission = (permission: Permission) =>
  createMiddleware<AppEnv>(async (c, next) => {
    assertCan(c.get('user'), permission);
    await next();
  });

export function assertCan(user: AuthUser, permission: Permission): void {
  if (!can(user.role, permission)) {
    throw new AppError(403, 'You do not have permission to do this. Ask the admin if you need it.');
  }
}

/** Branch IDs this request may touch: the school chosen at sign-in, or null for every school. */
export function branchScope(user: AuthUser): number[] | null {
  return user.scope;
}

export function canUseBranch(user: AuthUser, branchId: number): boolean {
  const scope = branchScope(user);
  return scope === null || scope.includes(branchId);
}

export function assertBranch(user: AuthUser, branchId: number): void {
  if (!canUseBranch(user, branchId)) {
    throw new AppError(
      403,
      'This belongs to another school. Switch school at the top of the screen to see it.',
    );
  }
}

/**
 * SQL fragment limiting a query to the user's branches, e.g. ` AND e.branch_id IN (1,2)`.
 * IDs come from our own database, never from the request, so inlining them is safe.
 */
export function scopeSql(user: AuthUser, column: string): string {
  const scope = branchScope(user);
  if (scope === null) return '';
  if (scope.length === 0) return ' AND 0';
  return ` AND ${column} IN (${scope.map((n) => Number(n)).join(',')})`;
}
