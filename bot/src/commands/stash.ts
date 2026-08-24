import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { Command } from "./command.js";

export const stash: Command = {
  data: new SlashCommandBuilder()
    .setName("stash")
    .setDescription("Browse the org's resource ledger")
    .toJSON(),

  async execute(interaction) {
    await interaction.reply({
      content: "Coming in P2 — browse the ledger at the website.",
      flags: MessageFlags.Ephemeral,
    });
  },
};
