import { MessageFlags } from "discord.js";
import type { Subcommand } from "./command.js";

export const stash: Subcommand = {
  name: "stash",
  define: (sub) => sub.setName("stash").setDescription("Browse the org's materials ledger"),

  async execute(interaction) {
    await interaction.reply({
      content: "Coming in P2 — browse the ledger at the website.",
      flags: MessageFlags.Ephemeral,
    });
  },
};
