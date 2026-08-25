import { MessageFlags } from "discord.js";
import { backend, BackendError } from "../lib/backend.js";
import { descriptions, resolveLocale, t } from "../i18n.js";
import type { Subcommand } from "./command.js";

const amount = (value: number, unit: "mscu" | "pieces", locale: string): string =>
  unit === "mscu"
    ? `${(value / 1000).toLocaleString(locale, { maximumFractionDigits: 3 })} SCU`
    : `${value.toLocaleString(locale)} ${t(locale, "need.pieces")}`;

/** Need-driven search: who holds the blueprint and the best materials, where. */
export const need: Subcommand = {
  name: "need",
  define: (sub) =>
    sub
      .setName("need")
      .setDescription(t("en", "commands.need"))
      .setDescriptionLocalizations(descriptions("commands.need"))
      .addStringOption((option) =>
        option
          .setName("item")
          .setDescription(t("en", "commands.optionItem"))
          .setDescriptionLocalizations(descriptions("commands.optionItem"))
          .setRequired(true),
      ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const locale = await resolveLocale(interaction);
    const item = interaction.options.getString("item", true);

    try {
      const { results } = await backend.need(interaction.user.id, item);
      if (results.length === 0) {
        await interaction.editReply(t(locale, "need.noMatch", { item }));
        return;
      }
      const blocks = results.map((r) => {
        const holders = r.blueprint.is_default
          ? t(locale, "need.everyone")
          : r.owners.length > 0
            ? r.owners.map((o) => o.member).join(", ")
            : t(locale, "need.nobody");
        const materials = r.ingredients.map((ing) => {
          const best = ing.holdings[0];
          const source = best
            ? t(locale, "need.source", {
                member: best.member,
                location: best.location,
                quality: ing.unit === "mscu" ? ` Q${best.quality}` : "",
              })
            : t(locale, "need.missing");
          return `  • ${ing.name} — ${amount(ing.available, ing.unit, locale)} / ${amount(ing.need, ing.unit, locale)} — ${source}`;
        });
        const status = r.craftable
          ? t(locale, "need.craftable", { quality: r.est_output_quality ?? "—" })
          : t(locale, "need.notCraftable");
        return [
          `**${r.blueprint.name}**${r.type_display ? ` · ${r.type_display}` : ""} — ${status}`,
          `${t(locale, "need.holders")}: ${holders}`,
          ...materials,
        ].join("\n");
      });
      await interaction.editReply(blocks.join("\n\n").slice(0, 1900));
    } catch (error) {
      if (error instanceof BackendError && error.status === 404) {
        await interaction.editReply(t(locale, "common.notRegistered"));
        return;
      }
      await interaction.editReply(
        t(locale, error instanceof BackendError && error.status === undefined ? "common.unreachable" : "common.backendError"),
      );
    }
  },
};
