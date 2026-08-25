import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { ensureAvatar } from "./avatar.js";
import { normalizeLocale, t } from "./i18n.js";
import { resolve } from "./commands/index.js";
import { config } from "./config.js";
import { startNotifyServer } from "./notify.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready as ${readyClient.user.tag}`);
  void ensureAvatar(readyClient);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = resolve(interaction);
  if (!command) {
    console.warn(`Unknown command: /${interaction.commandName} ${interaction.options.getSubcommandGroup(false) ?? ""} ${interaction.options.getSubcommand(false) ?? ""}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error executing /${interaction.commandName} ${command.name}:`, error);
    const message = t(normalizeLocale(interaction.locale), "common.error");
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message);
      } else {
        await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
      }
    } catch {
      // Interaction already expired; nothing more to do.
    }
  }
});

const notifyServer = startNotifyServer(client);

function shutdown(signal: string): void {
  console.log(`Received ${signal}, shutting down...`);
  notifyServer.close();
  void client.destroy().finally(() => process.exit(0));
  // Failsafe: force-exit if the gateway hangs.
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

await client.login(config.botToken);
