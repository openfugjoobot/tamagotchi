/**
 * Thin client for the Task-8 REST API (bearer-authenticated).
 *
 * One place for the fetch plumbing: the base URL, the `Authorization: Bearer`
 * header, JSON in/out, and a single failure shape. Every UI module (pets,
 * slots, settings, beeps) talks through here instead of hand-rolling `fetch`,
 * so a token change or an error convention stays in one file.
 *
 * The token is supplied per call (read from the auth module at call time) so a
 * silent GIS refresh is picked up automatically — nothing is cached here.
 */

/** Optional response headers the API may send (kept minimal on purpose). */
export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
}

async function request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  token: string | null,
  body?: unknown,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  try {
    const res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    // 204 (and other empty replies) have no JSON to parse.
    const text = await res.text();
    const data = text ? (JSON.parse(text) as T) : null;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export const api = {
  get: <T>(path: string, token: string | null) => request<T>("GET", path, token),
  post: <T>(path: string, token: string | null, body?: unknown) => request<T>("POST", path, token, body),
  put: <T>(path: string, token: string | null, body?: unknown) => request<T>("PUT", path, token, body),
  del: <T>(path: string, token: string | null) => request<T>("DELETE", path, token),
};
