import { createServer, type Server } from "node:http";
import type { APIEmbed, Client } from "discord.js";
import { config } from "./config.js";

interface NotifyPayload {
  channel_id: string;
  embed: APIEmbed;
}

function isNotifyPayload(value: unknown): value is NotifyPayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["channel_id"] === "string" &&
    typeof record["embed"] === "object" &&
    record["embed"] !== null
  );
}

/**
 * Tiny webhook server the Laravel queue posts notifications to:
 * POST /notify { channel_id, embed } with the shared bearer token.
 */
export function startNotifyServer(client: Client): Server {
  const server = createServer((req, res) => {
    const respond = (status: number, body: Record<string, unknown>): void => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

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
          respond(422, { error: "Expected { channel_id: string, embed: object }" });
          return;
        }

        try {
          const channel = await client.channels.fetch(payload.channel_id);
          if (!channel?.isSendable()) {
            respond(404, { error: "Channel not found or not sendable" });
            return;
          }
          await channel.send({ embeds: [payload.embed] });
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
