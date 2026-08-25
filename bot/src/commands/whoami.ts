import { MessageFlags } from "discord.js";
import { backend } from "../lib/backend.js";
import { descriptions, normalizeLocale, t } from "../i18n.js";
import type { Subcommand } from "./command.js";

export const whoami: Subcommand = {
  name: "whoami",
  define: (sub) =>
    sub
      .setName("whoami")
      .setDescription(t("en", "commands.whoami"))
      .setDescriptionLocalizations(descriptions("commands.whoami")),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    // The lookup itself tells us the member's language — no second call.
    let locale = normalizeLocale(interaction.locale);

    try {
      const member = await backend.member(interaction.user.id);
      if (member.registered) {
        locale = normalizeLocale(member.locale ?? interaction.locale);
        await interaction.editReply(
          t(locale, "whoami.registered", { handle: member.handle ?? t(locale, "whoami.unknownHandle") }),
        );
      } else {
        await interaction.editReply(t(locale, "whoami.notRegistered"));
      }
    } catch {
      await interaction.editReply(t(locale, "whoami.unreachable"));
    }
  },
};
