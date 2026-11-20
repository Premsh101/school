import type { Context } from 'hono';
import type { Role } from '../shared/permissions';

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: Role;
  /** Branches assigned to the user (accountants). Admin and management may use every branch. */
  assigned_branch_ids: number[];
  /** The school chosen at sign-in; null = all schools. */
  session_branch_id: number | null;
  /** The branches this request may touch, or null for every branch. Always use branchScope(). */
  scope: number[] | null;
  must_change_password: boolean;
  session_id: number;
}

export type AppEnv = {
  Bindings: { DB: D1Database; ASSETS?: Fetcher };
  Variables: { user: AuthUser };
};
export type Ctx = Context<AppEnv>;
