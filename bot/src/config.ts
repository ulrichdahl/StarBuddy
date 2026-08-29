import "dotenv/config";
import { readFileSync } from "node:fs";

/** Release version from package.json (next to dist/ in the image, next to src/ in dev). */
function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "dev";
  } catch {
    return "dev";
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  /** Discord bot token (from the Discord developer portal). */
  botToken: required("DISCORD_BOT_TOKEN"),
  /** Discord application (client) id. */
  applicationId: required("DISCORD_APPLICATION_ID"),
  /** The guild slash commands are registered to (the org's server). */
  homeGuildId: required("HOME_GUILD_ID"),
  /**
   * Base URL of the Laravel backend's internal bot API.
   * In docker compose this is typically http://web/ (nginx in front of app);
   * defaults to the app container directly.
   */
  backendUrl: (process.env["BACKEND_URL"] ?? "http://app:8000").replace(/\/+$/, ""),
  /** Bearer token for the Laravel internal bot API. */
  botApiToken: required("BOT_API_TOKEN"),
  /** Port for the notification webhook server. */
  notifyPort: Number(process.env["NOTIFY_PORT"] ?? 3000),
  /** Deployed version: update.sh bakes a git-describe string in via the build arg; otherwise the release version. */
  version: process.env["STARBUDDY_VERSION"] || packageVersion(),
} as const;

export type Config = typeof config;
