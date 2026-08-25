import { readFile } from "node:fs/promises";
import type { Client } from "discord.js";

/**
 * Give a freshly created bot user the StarBuddy icon so every self-hosted
 * instance comes up branded without a trip to the Developer Portal. Runs
 * only while the bot still wears Discord's default avatar — operators who
 * set their own avatar keep it. (Avatar changes are rate-limited to a
 * couple per hour; a failure here is logged, never fatal.)
 */
export async function ensureAvatar(client: Client<true>): Promise<void> {
  if (client.user.avatar !== null) {
    console.log("Bot avatar already set — keeping it.");
    return;
  }
  try {
    const png = await readFile(new URL("../assets/avatar.png", import.meta.url));
    await client.user.setAvatar(png);
    console.log("Set the bot avatar to the StarBuddy icon.");
  } catch (error) {
    console.warn("Could not set the bot avatar (will retry on next start):", error);
  }
}
