import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { backend, BackendError } from "../lib/backend.js";
import { descriptions, resolveLocale, t } from "../i18n.js";
import type { SubcommandGroup } from "./command.js";

function failureMessage(locale: string, error: unknown): string {
  if (error instanceof BackendError && error.status === undefined) {
    return t(locale, "common.unreachable");
  }
  return t(locale, "common.backendError");
}

const described = <B extends { setDescription(d: string): B; setDescriptionLocalizations(l: Record<string, string>): B }>(
  builder: B,
  key: string,
): B => builder.setDescription(t("en", key)).setDescriptionLocalizations(descriptions(key));

// Admin-only at runtime (Manage Server): a default-permission gate would
// hide the whole /starbuddy command from regular members.
export const org: SubcommandGroup = {
  name: "org",
  define: (group) => group
    .setName("org")
    .setDescription(t("en", "commands.org"))
    .setDescriptionLocalizations(descriptions("commands.org"))
    .addSubcommand((sub) => described(sub.setName("list"), "commands.orgList"))
    .addSubcommand((sub) =>
      described(sub.setName("create"), "commands.orgCreate").addStringOption((option) =>
        described(option.setName("name"), "commands.optionName").setRequired(true),
      ),
    )
    .addSubcommand((sub) =>
      described(sub.setName("delete"), "commands.orgDelete").addStringOption((option) =>
        described(option.setName("name"), "commands.optionName").setRequired(true),
      ),
    )
    .addSubcommand((sub) =>
      described(sub.setName("manager"), "commands.orgManager")
        .addUserOption((option) => described(option.setName("user"), "commands.optionUser").setRequired(true))
        .addStringOption((option) => described(option.setName("org"), "commands.optionOrg").setRequired(true))
        .addBooleanOption((option) => described(option.setName("remove"), "commands.optionRemove")),
    ),

  async execute(interaction) {
    const locale = await resolveLocale(interaction);
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: t(locale, "org.requiresManageServer"),
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
            await interaction.editReply(t(locale, "org.none"));
            return;
          }
          const lines = orgs.map((entry) =>
            t(locale, "org.listLine", { name: entry.name, count: entry.members_count }),
          );
          await interaction.editReply(`${t(locale, "org.listHeader")}\n${lines.join("\n")}`);
          return;
        }

        case "create": {
          const name = interaction.options.getString("name", true);
          const created = await backend.createOrg(name);
          await interaction.editReply(t(locale, "org.created", { name: created.name }));
          return;
        }

        case "delete": {
          const name = interaction.options.getString("name", true);
          try {
            await backend.deleteOrg(name);
            await interaction.editReply(t(locale, "org.deleted", { name }));
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
              t(locale, remove ? "org.managerRevoked" : "org.managerGranted", {
                member: result.member,
                org: result.org,
                role: result.role,
              }),
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
          await interaction.editReply(t(locale, "common.unknownSubcommand"));
          return;
      }
    } catch (error) {
      await interaction.editReply(failureMessage(locale, error));
    }
  },
};
