<?php

// Instance configuration. Keys read STARBUDDY_* and fall back to the
// pre-rename STARMAKER_* names so an un-migrated .env keeps working.
return [
    // Deployed version. update.sh bakes a git-describe string into the image
    // via the STARBUDDY_VERSION build arg; without one (Coolify, plain
    // `docker compose build`) fall back to the release version in composer.json.
    'version' => env('STARBUDDY_VERSION')
        ?: (json_decode((string) file_get_contents(base_path('composer.json')), true)['version'] ?? 'dev'),

    // Current Star Citizen patch. Prefills the game version on contributed
    // training screenshots, so a member never has to know it; bump it here
    // when the game updates.
    'game_patch' => env('STARBUDDY_GAME_PATCH', '4.10.0'),

    // The Discord server (guild) this instance belongs to. Only members of
    // this guild can sign in. Everything community-specific hangs off this.
    'home_guild_id' => env('STARBUDDY_HOME_GUILD_ID', env('STARMAKER_HOME_GUILD_ID')),

    // Bearer token shared with the bot container for the internal /api/bot API.
    'bot_api_token' => env('STARBUDDY_BOT_API_TOKEN', env('STARMAKER_BOT_API_TOKEN')),

    // Where the backend delivers Discord notifications (the bot's notify endpoint).
    'bot_notify_url' => env('STARBUDDY_BOT_NOTIFY_URL', env('STARMAKER_BOT_NOTIFY_URL', 'http://bot:3000/notify')),

    // Optional Discord channel that receives refinery-completion pings
    // (only for events fresher than a few minutes, so a first-run history
    // import never floods it). Empty = notifications off.
    // Optional Discord channel players can post their Gathering shopping
    // list to. Empty = the "Post to Discord" button is hidden.
    'gathering_channel_id' => env('STARBUDDY_GATHERING_CHANNEL_ID'),

    'refinery_channel_id' => env('STARBUDDY_REFINERY_CHANNEL_ID', env('STARMAKER_REFINERY_CHANNEL_ID')),

    // RSI service status (status.robertsspaceindustries.com) is polled every
    // minute. New maintenance/outage notices go to this Discord channel;
    // empty = no Discord alerts (the web/client banners still work).
    'status_channel_id' => env('STARBUDDY_STATUS_CHANNEL_ID', env('STARMAKER_STATUS_CHANNEL_ID')),
    // Text placed above a fresh alert so it actually pings: "@here",
    // "@everyone" or a role mention like "<@&123456789>". Empty = no ping.
    'status_mention' => env('STARBUDDY_STATUS_MENTION', env('STARMAKER_STATUS_MENTION', '@here')),
    'status_url' => env('STARBUDDY_STATUS_URL', env('STARMAKER_STATUS_URL', 'https://status.robertsspaceindustries.com')),

    // Discord role in the home guild whose holders see features still being
    // tried out (scan training). Read at sign-in. Unset or empty = shown to
    // everyone.
    'tester_role_id' => env('STARBUDDY_TESTER_ROLE_ID', ''),

    // Discord role id => org name. Members holding the role are attached to
    // the org on login. Format: JSON object, e.g. {"123456789":"Stellar Forge"}
    'role_org_map' => json_decode(env('STARBUDDY_ROLE_ORG_MAP', env('STARMAKER_ROLE_ORG_MAP', '{}')), true) ?: [],

    // The UDI website whose StarLabels/StarConfig tools StarBuddy links to
    // (docs: UnitedDanes website docs/starbuddy-api.md). The server only
    // checks the link's status and unlinks; desktop clients fetch the files.
    'udi_url' => rtrim(env('STARBUDDY_UDI_URL', 'https://uniteddanes.org'), '/'),
    // Where the player's browser opens the setup page. Differs from udi_url
    // only in local dev, where the server reaches UDI through the Docker host.
    'udi_public_url' => rtrim(env('STARBUDDY_UDI_PUBLIC_URL') ?: env('STARBUDDY_UDI_URL', 'https://uniteddanes.org'), '/'),

    // GitHub repository (owner/name) whose latest release holds the desktop
    // client installers. The website links straight to the file for the
    // visitor's platform. A self-hosted instance with its own builds sets this.
    'client_repo' => env('STARBUDDY_CLIENT_REPO', 'ulrichdahl/StarBuddy'),

    // Invite link to the home Discord server (https://discord.gg/…). The
    // sign-in page offers it to someone refused for not being a member.
    // Empty = no link.
    'discord_invite' => env('STARBUDDY_DISCORD_INVITE', ''),
];
