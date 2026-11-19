import type { Context } from 'hono';
import type { Role } from '../shared/permissions';

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: Role;
  /** Branches assigned to the user. Admins ignore this and see every branch. */
  branch_ids: number[];
  session_id: number;
}

export type AppEnv = {
  Bindings: { DB: D1Database; ASSETS?: Fetcher };
  Variables: { user: AuthUser };
};
export type Ctx = Context<AppEnv>;
