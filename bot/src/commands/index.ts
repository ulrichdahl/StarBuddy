import { SlashCommandBuilder } from "discord.js";
import type {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import type { Subcommand, SubcommandGroup } from "./command.js";
import { descriptions, t } from "../i18n.js";
import { org } from "./org.js";
import { ping } from "./ping.js";
import { stash } from "./stash.js";
import { whoami } from "./whoami.js";

export type { Subcommand, SubcommandGroup } from "./command.js";

/** The one top-level command everything lives under. */
export const ROOT = "starbuddy";

const subcommands: Subcommand[] = [ping, whoami, stash];
const groups: SubcommandGroup[] = [org];

export function buildRootCommand(): RESTPostAPIChatInputApplicationCommandsJSONBody {
  const root = new SlashCommandBuilder()
    .setName(ROOT)
    .setDescription(t("en", "commands.root"))
    .setDescriptionLocalizations(descriptions("commands.root"));
  for (const sub of subcommands) root.addSubcommand((b) => sub.define(b));
  for (const group of groups) root.addSubcommandGroup((b) => group.define(b));
  return root.toJSON();
}

/** Human list of the registered paths, for logs. */
export function commandPaths(): string[] {
  return [
    ...subcommands.map((s) => `/${ROOT} ${s.name}`),
    ...groups.map((g) => `/${ROOT} ${g.name} …`),
  ];
}

/** Route an interaction to the subcommand or group that owns it. */
export function resolve(
  interaction: ChatInputCommandInteraction,
): Subcommand | SubcommandGroup | undefined {
  if (interaction.commandName !== ROOT) return undefined;
  const group = interaction.options.getSubcommandGroup(false);
  if (group) return groups.find((g) => g.name === group);
  const sub = interaction.options.getSubcommand(false);
  return subcommands.find((s) => s.name === sub);
}
