import { SlashCommandBuilder } from "discord.js";
import { backend } from "../lib/backend.js";
import type { Command } from "./command.js";

export const ping: Command = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency and backend health")
    .toJSON(),

  async execute(interaction) {
    await interaction.deferReply();
    const sent = await interaction.fetchReply();
    const latency = sent.createdTimestamp - interaction.createdTimestamp;

    let backendStatus: string;
    try {
      const health = await backend.health();
      backendStatus = health.ok ? "healthy" : "unhealthy";
    } catch (error) {
      backendStatus = `unreachable (${error instanceof Error ? error.message : String(error)})`;
    }

    await interaction.editReply(
      `Pong! Latency: ${latency}ms | WS: ${Math.round(interaction.client.ws.ping)}ms | Backend: ${backendStatus}`,
    );
  },
};
