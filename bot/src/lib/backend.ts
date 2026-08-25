import { config } from "../config.js";

/** Response of GET /api/bot/health */
export interface HealthResponse {
  ok?: boolean;
  status?: string;
  time?: string;
  version?: string;
}

export const isHealthy = (h: HealthResponse): boolean => h.ok === true || h.status === "ok";

/** Response of GET /api/bot/member/:discordId */
export interface MemberLookupResponse {
  registered: boolean;
  /** The member's Star Citizen handle, when registered. */
  handle?: string | null;
  /** UI language chosen on the website ('en' | 'da'), when registered. */
  locale?: string | null;
}

/** One entry of GET /api/bot/orgs */
export interface OrgSummary {
  id: number;
  name: string;
  members_count: number;
}

/** Response of POST /api/bot/orgs */
export interface OrgCreateResponse {
  id: number;
  name: string;
}

/** Response of DELETE /api/bot/orgs/:name */
export interface OrgDeleteResponse {
  deleted: boolean;
}

/** Response of POST /api/bot/orgs/:name/manager */
export interface OrgManagerResponse {
  org: string;
  member: string;
  role: string;
}

/** One row of GET /api/bot/craftable/:discordId */
export interface CraftableRow {
  id: number;
  name: string;
  type_display: string | null;
  grade: string | null;
  est_output_quality: number | null;
  craftable: boolean;
  coverage: number;
  owner_count: number;
  owned_by_me: boolean;
  is_default: boolean;
}

export interface CraftableResponse {
  /** "material": recipes consuming the matched material; "name": name filter. */
  mode: "material" | "name";
  material: string | null;
  total: number;
  results: CraftableRow[];
}

/** One recipe of GET /api/bot/need/:discordId?q= */
export interface NeedResult {
  blueprint: { id: number; name: string; is_default: boolean };
  type_display: string | null;
  owners: { member: string; uses_personal: number; uses_org: number }[];
  ingredients: {
    name: string;
    need: number;
    unit: "mscu" | "pieces";
    available: number;
    holdings: { member: string; location: string; system: string | null; quality: number; quantity: number }[];
  }[];
  craftable: boolean;
  est_output_quality: number | null;
}

export type NeedResponse =
  | { mode: "name"; results: NeedResult[] }
  /** The term was a category/slot: the whole family, craftable first. */
  | { mode: "category"; category: string; total: number; results: CraftableRow[] };

export class BackendError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.botApiToken}`,
    Accept: "application/json",
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  let response: Response;
  try {
    response = await fetch(`${config.backendUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (cause) {
    throw new BackendError(`Backend unreachable: ${String(cause)}`);
  }
  if (!response.ok) {
    let message = `Backend responded ${response.status} for ${path}`;
    try {
      const payload = (await response.json()) as { message?: unknown };
      if (typeof payload.message === "string" && payload.message.length > 0) {
        message = payload.message;
      }
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new BackendError(message, response.status);
  }
  return (await response.json()) as T;
}

export const backend = {
  health: () => request<HealthResponse>("/api/bot/health"),
  member: (discordId: string) =>
    request<MemberLookupResponse>(`/api/bot/member/${encodeURIComponent(discordId)}`),
  craftable: (discordId: string, search?: string, limit = 10) =>
    request<CraftableResponse>(
      `/api/bot/craftable/${encodeURIComponent(discordId)}?limit=${limit}${search ? `&search=${encodeURIComponent(search)}` : ""}`,
    ),
  need: (discordId: string, q: string) =>
    request<NeedResponse>(`/api/bot/need/${encodeURIComponent(discordId)}?q=${encodeURIComponent(q)}`),
  orgs: () => request<OrgSummary[]>("/api/bot/orgs"),
  createOrg: (name: string) =>
    request<OrgCreateResponse>("/api/bot/orgs", { method: "POST", body: { name } }),
  deleteOrg: (name: string) =>
    request<OrgDeleteResponse>(`/api/bot/orgs/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  setOrgManager: (org: string, discordId: string, manager: boolean) =>
    request<OrgManagerResponse>(`/api/bot/orgs/${encodeURIComponent(org)}/manager`, {
      method: "POST",
      body: { discord_id: discordId, manager },
    }),
};
