import { EmbedBuilder } from "discord.js";
import { backend, type StatusIncident } from "../lib/backend.js";
import { descriptions, resolveLocale, t } from "../i18n.js";
import type { Subcommand } from "./command.js";

const COLORS: Record<string, number> = {
  down: 0xe60000,
  disrupted: 0xcc4400,
  maintenance: 0xe0a526,
  notice: 0x24478f,
  operational: 0x2e8b57,
};

const unix = (iso: string | null): number | null =>
  iso ? Math.floor(new Date(iso).getTime() / 1000) : null;

function describe(locale: string, incident: StatusIncident): string {
  const lines: string[] = [];
  const body = incident.body_text.length > 900 ? `${incident.body_text.slice(0, 900)}…` : incident.body_text;
  if (body) lines.push(body);
  if (incident.affected.length > 0) {
    lines.push(t(locale, "status.affected", { systems: incident.affected.join(", ") }));
  }
  const shutdown = unix(incident.shutdown_at);
  if (shutdown && !incident.resolved) {
    lines.push(t(locale, "status.shutdown", { time: `<t:${shutdown}:t>`, relative: `<t:${shutdown}:R>` }));
  }
  return lines.join("\n\n");
}

/** Current RSI service status, as mirrored by the backend's poller. */
export const status: Subcommand = {
  name: "status",
  define: (sub) =>
    sub
      .setName("status")
      .setDescription(t("en", "commands.status"))
      .setDescriptionLocalizations(descriptions("commands.status")),

  async execute(interaction) {
    await interaction.deferReply();
    const locale = await resolveLocale(interaction);

    let data;
    try {
      data = await backend.status();
    } catch (error) {
      await interaction.editReply(
        t(locale, "status.unavailable", { error: error instanceof Error ? error.message : String(error) }),
      );
      return;
    }

    const embeds: EmbedBuilder[] = [];
    if (data.active.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle(t(locale, "status.allClearTitle"))
        .setDescription(t(locale, "status.allClear"))
        .setColor(COLORS["operational"] ?? 0x2e8b57)
        .setURL(data.status_url);
      const fetched = unix(data.fetched_at);
      if (fetched) embed.setFooter({ text: t(locale, "status.checked") }).setTimestamp(fetched * 1000);
      embeds.push(embed);
    } else {
      for (const incident of data.active.slice(0, 3)) {
        const severityKey = `status.severity.${incident.severity}`;
        const translated = t(locale, severityKey);
        const label = translated === severityKey ? incident.severity : translated;
        const embed = new EmbedBuilder()
          .setTitle(`${label} — ${incident.title}`)
          .setDescription(describe(locale, incident) || incident.title)
          .setColor(COLORS[incident.severity] ?? COLORS["notice"] ?? 0x24478f)
          .setFooter({ text: "status.robertsspaceindustries.com" });
        if (incident.permalink) embed.setURL(incident.permalink);
        if (incident.updated_at) embed.setTimestamp(new Date(incident.updated_at));
        embeds.push(embed);
      }
    }

    if (data.recent.length > 0) {
      const recent = data.recent
        .slice(0, 3)
        .map((r) => {
          const at = unix(r.resolved_at);
          return `• ${r.title}${at ? ` — <t:${at}:R>` : ""}`;
        })
        .join("\n");
      embeds.push(
        new EmbedBuilder()
          .setTitle(t(locale, "status.recentTitle"))
          .setDescription(recent)
          .setColor(COLORS["operational"] ?? 0x2e8b57),
      );
    }

    await interaction.editReply({ embeds });
  },
};
