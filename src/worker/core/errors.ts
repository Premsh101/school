import type { z } from 'zod';

/** An error whose message is safe and useful to show to office staff. */
export class AppError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 429,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (what: string) =>
  new AppError(404, `${what} was not found. It may have been removed.`);

/** Validates request data; on failure says which fields are wrong and why. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.');
    if (!(key in fields)) fields[key] = issue.message;
  }
  const [firstKey, firstMessage] = Object.entries(fields)[0] ?? ['', 'Check the form'];
  const label = firstKey ? `${firstKey.replace(/_/g, ' ')}: ` : '';
  throw new AppError(400, `Please check ${label}${firstMessage}`, fields);
}

export function intParam(value: string | undefined, what: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw notFound(what);
  return n;
}
