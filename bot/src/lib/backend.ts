import { config } from "../config.js";

/** Response of GET /api/bot/health */
export interface HealthResponse {
  ok: boolean;
  version?: string;
}

/** Response of GET /api/bot/member/:discordId */
export interface MemberLookupResponse {
  registered: boolean;
  /** The member's Star Citizen handle, when registered. */
  handle?: string | null;
}

export class BackendError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

async function request<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.backendUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${config.botApiToken}`,
        Accept: "application/json",
      },
    });
  } catch (cause) {
    throw new BackendError(`Backend unreachable: ${String(cause)}`);
  }
  if (!response.ok) {
    throw new BackendError(`Backend responded ${response.status} for ${path}`, response.status);
  }
  return (await response.json()) as T;
}

export const backend = {
  health: () => request<HealthResponse>("/api/bot/health"),
  member: (discordId: string) =>
    request<MemberLookupResponse>(`/api/bot/member/${encodeURIComponent(discordId)}`),
};
