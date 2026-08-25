import { REST, Routes } from "discord.js";
import { buildRootCommand, commandPaths } from "./commands/index.js";
import { config } from "./config.js";

const rest = new REST().setToken(config.botToken);
const body = [buildRootCommand()];

console.log(
  `Registering /starbuddy in guild ${config.homeGuildId}: ${commandPaths().join(", ")}`,
);

await rest.put(Routes.applicationGuildCommands(config.applicationId, config.homeGuildId), {
  body,
});

console.log("Done.");
