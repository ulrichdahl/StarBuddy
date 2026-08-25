import type {
  ChatInputCommandInteraction,
  SlashCommandSubcommandBuilder,
  SlashCommandSubcommandGroupBuilder,
} from "discord.js";

/**
 * Every bot feature hangs off the single `/starbuddy` root command, either
 * as a subcommand (`/starbuddy ping`) or a subcommand group
 * (`/starbuddy org create …`).
 */
export interface Subcommand {
  name: string;
  define(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

export interface SubcommandGroup {
  name: string;
  define(group: SlashCommandSubcommandGroupBuilder): SlashCommandSubcommandGroupBuilder;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}
