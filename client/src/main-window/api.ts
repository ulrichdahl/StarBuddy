import { invoke } from "@tauri-apps/api/core";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * The paired website's API, through the client (api.rs), which holds the
 * device token. `path` starts with /api/.
 */
export function serverApi<T>(method: Method, path: string, options: { query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {}) {
  const query = options.query
    ? Object.entries(options.query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)] as [string, string])
    : undefined;
  return invoke<T>("server_api", { method, path, query, body: options.body ?? null });
}

/** A Laravel page of results. */
export interface Paginated<T> {
  data: T[];
  total: number;
  current_page: number;
  last_page: number;
}
