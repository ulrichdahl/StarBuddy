import { createServer, type Server } from "node:http";
import type { APIEmbed, Client } from "discord.js";
import { config } from "./config.js";

interface NotifyPayload {
  /** A channel to post in, or… */
  channel_id?: string;
  /** …a member to send a direct message to. */
  user_id?: string;
  embed: APIEmbed;
  /** Plain text above the embed — the only place a mention actually pings. */
  content?: string | null;
}

function isNotifyPayload(value: unknown): value is NotifyPayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (typeof record["channel_id"] === "string" || typeof record["user_id"] === "string") &&
    typeof record["embed"] === "object" &&
    record["embed"] !== null &&
    (record["content"] === undefined || record["content"] === null || typeof record["content"] === "string")
  );
}

/**
 * Tiny webhook server the Laravel queue posts notifications to:
 * POST /notify { channel_id | user_id, embed, content? } with the shared
 * bearer token. user_id sends a direct message; a member who blocks DMs
 * gets nothing, answered as 200 { delivered: false } so it is not retried.
 * GET /health answers 200 once the Discord gateway session is ready
 * (503 before) — the container healthcheck in docker-compose.yml polls it.
 */
export function startNotifyServer(client: Client): Server {
  const server = createServer((req, res) => {
    const respond = (status: number, body: Record<string, unknown>): void => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.method === "GET" && req.url === "/health") {
      const ready = client.isReady();
      respond(ready ? 200 : 503, { ok: ready, ready });
      return;
    }
    if (req.method !== "POST" || req.url !== "/notify") {
      respond(404, { error: "Not found" });
      return;
    }
    if (req.headers.authorization !== `Bearer ${config.botApiToken}`) {
      respond(401, { error: "Unauthorized" });
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      void (async () => {
        let payload: unknown;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          respond(400, { error: "Invalid JSON" });
          return;
        }
        if (!isNotifyPayload(payload)) {
          respond(422, { error: "Expected { channel_id or user_id: string, embed: object }" });
          return;
        }

        if (payload.user_id !== undefined) {
          try {
            const user = await client.users.fetch(payload.user_id);
            await user.send({ content: payload.content ?? undefined, embeds: [payload.embed], allowedMentions: { parse: [] } });
            respond(200, { ok: true, delivered: true });
          } catch (error) {
            // The member can't be reached, and a retry won't change that:
            // 50007 DMs closed, 50278 DMs closed in every shared server (or
            // none shared any more), 10013 unknown user.
            const code = (error as { code?: number }).code;
            if (code === 50007 || code === 50278 || code === 10013) {
              console.log(`Direct message not delivered (Discord ${code})`);
              respond(200, { ok: true, delivered: false });
              return;
            }
            console.error("Failed to deliver direct message:", error);
            respond(502, { error: "Failed to deliver direct message" });
          }
          return;
        }

        try {
          const channel = await client.channels.fetch(payload.channel_id as string);
          if (!channel?.isSendable()) {
            respond(404, { error: "Channel not found or not sendable" });
            return;
          }
          await channel.send({
            content: payload.content ?? undefined,
            embeds: [payload.embed],
            // Status alerts lead with "@here" or a role mention; let those
            // through (the bot only ever posts to operator-chosen channels).
            allowedMentions: { parse: ["everyone", "roles", "users"] },
          });
          respond(200, { ok: true });
        } catch (error) {
          console.error("Failed to deliver notification:", error);
          respond(502, { error: "Failed to deliver notification" });
        }
      })();
    });
  });

  server.listen(config.notifyPort, () => {
    console.log(`Notify server listening on port ${config.notifyPort}`);
  });
  return server;
}
