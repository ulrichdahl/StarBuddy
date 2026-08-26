import { backend, isHealthy } from "../lib/backend.js";
import { config } from "../config.js";
import { descriptions, resolveLocale, t } from "../i18n.js";
import type { Subcommand } from "./command.js";

export const ping: Subcommand = {
  name: "ping",
  define: (sub) =>
    sub
      .setName("ping")
      .setDescription(t("en", "commands.ping"))
      .setDescriptionLocalizations(descriptions("commands.ping")),

  async execute(interaction) {
    await interaction.deferReply();
    const locale = await resolveLocale(interaction);
    const sent = await interaction.fetchReply();
    const latency = sent.createdTimestamp - interaction.createdTimestamp;

    let backendStatus: string;
    let backendVersion = "?";
    try {
      const health = await backend.health();
      backendStatus = t(locale, isHealthy(health) ? "ping.healthy" : "ping.unhealthy");
      backendVersion = health.version ?? "?";
    } catch (error) {
      backendStatus = t(locale, "ping.unreachable", { error: error instanceof Error ? error.message : String(error) });
    }

    await interaction.editReply(
      t(locale, "ping.reply", {
        latency,
        ws: Math.round(interaction.client.ws.ping),
        backend: backendStatus,
        version: t(locale, "ping.versions", { bot: config.version, api: backendVersion }),
      }),
    );
  },
};
