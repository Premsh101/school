import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { can, seesAllBranches, type Permission, type Role } from '../../shared/permissions';
import type { AppEnv, AuthUser, Ctx } from '../env';
import { AppError } from './errors';
import { newToken, sha256 } from './password';

const COOKIE = 'sid';
const SESSION_DAYS = 30;
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Creates a sign-in session row and sets the cookie. Returns the statement to run. */
export async function startSession(c: Ctx, userId: number): Promise<D1PreparedStatement> {
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
    'INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).bind(await sha256(token), userId, now, now + maxAge);
}

export function clearSessionCookie(c: Ctx): void {
  deleteCookie(c, COOKIE, { path: '/' });
}

/** Looks up the signed-in user from the cookie (one query). Null if not signed in. */
export async function currentUser(c: Ctx): Promise<AuthUser | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.name, u.role, s.id AS session_id,
            (SELECT group_concat(branch_id) FROM user_branches WHERE user_id = u.id) AS branch_ids
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
  )
    .bind(await sha256(token), nowSeconds())
    .first<{
      id: number;
      username: string;
      name: string;
      role: Role;
      session_id: number;
      branch_ids: string | null;
    }>();
  if (!row) return null;
  return { ...row, branch_ids: row.branch_ids ? row.branch_ids.split(',').map(Number) : [] };
}

/** Every route below this middleware needs a signed-in user. */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const user = await currentUser(c);
  if (!user) throw new AppError(401, 'Please sign in again.');
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

/** Branch IDs the user may touch, or null when they may touch all of them. */
export function branchScope(user: AuthUser): number[] | null {
  return seesAllBranches(user.role) ? null : user.branch_ids;
}

export function canUseBranch(user: AuthUser, branchId: number): boolean {
  const scope = branchScope(user);
  return scope === null || scope.includes(branchId);
}

export function assertBranch(user: AuthUser, branchId: number): void {
  if (!canUseBranch(user, branchId)) {
    throw new AppError(403, 'You do not have access to this branch.');
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
