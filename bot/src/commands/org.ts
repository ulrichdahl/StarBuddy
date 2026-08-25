import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { backend, BackendError } from "../lib/backend.js";
import type { Command } from "./command.js";

function failureMessage(error: unknown): string {
  if (error instanceof BackendError && error.status === undefined) {
    return "StarBuddy backend is unreachable.";
  }
  return "Something went wrong talking to the StarBuddy backend. Please try again later.";
}

export const org: Command = {
  data: new SlashCommandBuilder()
    .setName("org")
    .setDescription("Manage StarBuddy orgs")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName("list").setDescription("List all orgs"))
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Create an org")
        .addStringOption((option) =>
          option.setName("name").setDescription("Name of the org").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Delete an org")
        .addStringOption((option) =>
          option.setName("name").setDescription("Name of the org").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("manager")
        .setDescription("Grant or revoke an org's manager role")
        .addUserOption((option) =>
          option.setName("user").setDescription("The Discord member").setRequired(true),
        )
        .addStringOption((option) =>
          option.setName("org").setDescription("Name of the org").setRequired(true),
        )
        .addBooleanOption((option) =>
          option
            .setName("remove")
            .setDescription("Remove the manager role instead of granting it"),
        ),
    )
    .toJSON(),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: "Requires the Manage Server permission.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      switch (interaction.options.getSubcommand()) {
        case "list": {
          const orgs = await backend.orgs();
          if (orgs.length === 0) {
            await interaction.editReply("No orgs yet.");
            return;
          }
          const lines = orgs.map(
            (entry) =>
              `• **${entry.name}** — ${entry.members_count} member${entry.members_count === 1 ? "" : "s"}`,
          );
          await interaction.editReply(`Orgs:\n${lines.join("\n")}`);
          return;
        }

        case "create": {
          const name = interaction.options.getString("name", true);
          const created = await backend.createOrg(name);
          await interaction.editReply(`Org **${created.name}** is ready.`);
          return;
        }

        case "delete": {
          const name = interaction.options.getString("name", true);
          try {
            await backend.deleteOrg(name);
            await interaction.editReply(`Org **${name}** has been deleted.`);
          } catch (error) {
            if (error instanceof BackendError && error.status === 404) {
              await interaction.editReply(error.message);
              return;
            }
            throw error;
          }
          return;
        }

        case "manager": {
          const user = interaction.options.getUser("user", true);
          const orgName = interaction.options.getString("org", true);
          const remove = interaction.options.getBoolean("remove") ?? false;
          try {
            const result = await backend.setOrgManager(orgName, user.id, !remove);
            await interaction.editReply(
              remove
                ? `**${result.member}** is no longer a manager of **${result.org}** (role: ${result.role}).`
                : `**${result.member}** is now a manager of **${result.org}** (role: ${result.role}).`,
            );
          } catch (error) {
            if (error instanceof BackendError && error.status === 404) {
              await interaction.editReply(error.message);
              return;
            }
            throw error;
          }
          return;
        }

        default:
          await interaction.editReply("Unknown subcommand.");
          return;
      }
    } catch (error) {
      await interaction.editReply(failureMessage(error));
    }
  },
};
