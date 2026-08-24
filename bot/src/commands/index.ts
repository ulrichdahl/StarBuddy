import type { Command } from "./command.js";
import { ping } from "./ping.js";
import { stash } from "./stash.js";
import { whoami } from "./whoami.js";

export type { Command } from "./command.js";

export const commands = new Map<string, Command>(
  [ping, whoami, stash].map((command) => [command.data.name, command]),
);
