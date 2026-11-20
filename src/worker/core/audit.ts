import type { Ctx } from '../env';

export interface AuditEntry {
  action: string;
  entity: string;
  /** Pass 'last' to use the row inserted by the previous statement in the same batch. */
  entity_id?: number | 'last' | null;
  branch_id?: number | null;
  summary: string;
  details?: unknown;
}

/** Returns a statement that records who did what. Add it to the same batch as the change. */
export function audit(c: Ctx, entry: AuditEntry): D1PreparedStatement {
  const user = c.get('user') as { id: number; name: string } | undefined;
  const idSql = entry.entity_id === 'last' ? 'last_insert_rowid()' : '?';
  const stmt = c.env.DB.prepare(
    `INSERT INTO audit_log (at, user_id, user_name, action, entity, branch_id, summary, details, entity_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${idSql})`,
  );
  const values: unknown[] = [
    new Date().toISOString(),
    user?.id ?? null,
    user?.name ?? '',
    entry.action,
    entry.entity,
    entry.branch_id ?? null,
    entry.summary,
    entry.details === undefined ? null : JSON.stringify(entry.details),
  ];
  if (entry.entity_id !== 'last') values.push(entry.entity_id ?? null);
  return stmt.bind(...values);
}
