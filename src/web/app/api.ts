import type { ApiError } from '../../shared/types';
import { t } from './i18n';

/** An error from the server, with a message written for the person using the app. */
export class ApiFailure extends Error {
  constructor(
    message: string,
    public status: number,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

let onSignedOut: () => void = () => {};
export function setSignedOutHandler(handler: () => void): void {
  onSignedOut = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiFailure(t('No internet connection. Check your network and try again.'), 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiError>;
    if (res.status === 401 && !path.startsWith('/auth/login')) onSignedOut();
    throw new ApiFailure(
      err.error ?? t('Something went wrong. Please try again.'),
      res.status,
      err.fields,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T = { ok: true }>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T = { ok: true }>(path: string, body: unknown = {}) => request<T>('PUT', path, body),
};

export function query(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}
