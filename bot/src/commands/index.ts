import type { Command } from "./command.js";
import { org } from "./org.js";
import { ping } from "./ping.js";
import { stash } from "./stash.js";
import { whoami } from "./whoami.js";

export type { Command } from "./command.js";

export const commands = new Map<string, Command>(
  [ping, whoami, stash, org].map((command) => [command.data.name, command]),
);
