import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { backend } from "../lib/backend.js";
import type { Command } from "./command.js";

export const whoami: Command = {
  data: new SlashCommandBuilder()
    .setName("whoami")
    .setDescription("Check your StarMaker registration status")
    .toJSON(),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const member = await backend.member(interaction.user.id);
      if (member.registered) {
        await interaction.editReply(
          `You are registered with StarMaker as **${member.handle ?? "unknown handle"}**.`,
        );
      } else {
        await interaction.editReply(
          "You are not registered with StarMaker yet. Link your Discord account on the website to get started.",
        );
      }
    } catch {
      await interaction.editReply(
        "Could not reach the StarMaker backend. Please try again later.",
      );
    }
  },
};
