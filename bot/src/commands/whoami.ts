import { MessageFlags } from "discord.js";
import { backend } from "../lib/backend.js";
import type { Subcommand } from "./command.js";

export const whoami: Subcommand = {
  name: "whoami",
  define: (sub) => sub.setName("whoami").setDescription("Check your StarBuddy registration status"),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const member = await backend.member(interaction.user.id);
      if (member.registered) {
        await interaction.editReply(
          `You are registered with StarBuddy as **${member.handle ?? "unknown handle"}**.`,
        );
      } else {
        await interaction.editReply(
          "You are not registered with StarBuddy yet. Link your Discord account on the website to get started.",
        );
      }
    } catch {
      await interaction.editReply(
        "Could not reach the StarBuddy backend. Please try again later.",
      );
    }
  },
};
