import { MessageFlags } from "discord.js";
import { backend, BackendError } from "../lib/backend.js";
import { descriptions, resolveLocale, t } from "../i18n.js";
import type { Subcommand } from "./command.js";

/** What the member's orgs can craft right now, best output quality first. */
export const craftable: Subcommand = {
  name: "craftable",
  define: (sub) =>
    sub
      .setName("craftable")
      .setDescription(t("en", "commands.craftable"))
      .setDescriptionLocalizations(descriptions("commands.craftable"))
      .addStringOption((option) =>
        option
          .setName("search")
          .setDescription(t("en", "commands.optionSearch"))
          .setDescriptionLocalizations(descriptions("commands.optionSearch")),
      ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const locale = await resolveLocale(interaction);
    const search = interaction.options.getString("search") ?? undefined;

    try {
      const { total, results } = await backend.craftable(interaction.user.id, search, 10);
      if (results.length === 0) {
        await interaction.editReply(t(locale, search ? "craftable.noneMatching" : "craftable.none", { search: search ?? "" }));
        return;
      }
      const lines = results.map((r) =>
        t(locale, "craftable.line", {
          name: r.name,
          type: r.type_display ?? "",
          quality: r.est_output_quality ?? t(locale, "craftable.noQuality"),
          holders: r.is_default ? t(locale, "craftable.everyone") : t(locale, "craftable.holders", { count: r.owner_count + (r.owned_by_me ? 1 : 0) }),
        }),
      );
      const header = t(locale, "craftable.header", { count: total });
      const more = total > results.length ? `\n${t(locale, "craftable.more", { count: total - results.length })}` : "";
      await interaction.editReply(`${header}\n${lines.join("\n")}${more}`);
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
