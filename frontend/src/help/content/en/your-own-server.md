# StarBuddy for your Discord server

Every StarBuddy installation belongs to exactly one Discord server. Only members of that server can sign in, its bot posts in that server's channels, and the orgs, stock and points stay inside that community. To use StarBuddy with your own Discord server, you run your own installation.

StarBuddy is free software under the GNU AGPL-3.0. Any Discord server owner may install it, run it and link it to their server, at no cost and without asking anyone. Your members' data stays on your own machine.

## What a StarBuddy installation is linked to

| Setting | What it decides |
| --- | --- |
| Your Discord server's id | Who may sign in: members of that server, nobody else |
| A Discord application and bot of your own | Sign-in with Discord, slash commands and alerts in your channels |
| Your website address | Where your members sign in, and what they pair the desktop client with |

The desktop client is the same for every installation. Your members download it and pair it with your website's address.

## What you need

- A Linux server with Docker and Docker Compose, or a platform such as Coolify.
- A domain with HTTPS in front of it.
- A Discord server where you are an administrator.

## Setting it up

1. **Create a Discord application** at the Discord developer portal. Note its application id, client id and secret, and add the sign-in redirect address `https://your-domain/api/auth/discord/callback`. Create its bot, keep it private, and invite it to your server.
2. **Copy your server's id:** switch on Developer Mode in Discord, right-click the server and choose *Copy Server ID*.
3. **Get StarBuddy** from GitHub and fill in its settings file: your domain, the Discord credentials and your server's id.
4. **Start it**, run the one-time setup, and sign in with Discord to check that it works.
5. **Create your orgs:** a Discord server admin runs `/starbuddy org create` and `/starbuddy org manager` in Discord. Members then ask to join on the website, and the managers accept them.

The full guide, with every command, is [HOSTING.md on GitHub](https://github.com/ulrichdahl/StarBuddy/blob/main/HOSTING.md).

## Optional

- **Server alerts:** a channel where the bot posts RSI maintenance and outage notices the minute they appear, so players have time to stow their ships.
- **Refinery pings:** a channel that hears when a member's refinery work order is done.
- **Shopping lists:** a channel members can post their [Gathering](gathering) list to.
- **Testers:** a Discord role whose members see [Scan training](training).

## Updates

StarBuddy can update itself every night: a script fetches the new version, backs up the database first, and restarts. On Coolify, a new release deploys by itself.

Questions? Ask on GitHub, or in the United Danes Discord.
