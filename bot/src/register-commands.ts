import { REST, Routes } from "discord.js";
import { commands } from "./commands/index.js";
import { config } from "./config.js";

const rest = new REST().setToken(config.botToken);
const body = [...commands.values()].map((command) => command.data);

console.log(
  `Registering ${body.length} guild command(s) in guild ${config.homeGuildId}: ${body
    .map((c) => `/${c.name}`)
    .join(", ")}`,
);

await rest.put(Routes.applicationGuildCommands(config.applicationId, config.homeGuildId), {
  body,
});

console.log("Done.");
