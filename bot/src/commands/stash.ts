import { MessageFlags } from "discord.js";
import { descriptions, resolveLocale, t } from "../i18n.js";
import type { Subcommand } from "./command.js";

export const stash: Subcommand = {
  name: "stash",
  define: (sub) =>
    sub
      .setName("stash")
      .setDescription(t("en", "commands.stash"))
      .setDescriptionLocalizations(descriptions("commands.stash")),

  async execute(interaction) {
    const locale = await resolveLocale(interaction);
    await interaction.reply({
      content: t(locale, "stash.comingSoon"),
      flags: MessageFlags.Ephemeral,
    });
  },
};
