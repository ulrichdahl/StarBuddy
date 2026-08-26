<?php

// Instance configuration. Keys read STARBUDDY_* and fall back to the
// pre-rename STARMAKER_* names so an un-migrated .env keeps working.
return [
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
    'refinery_channel_id' => env('STARBUDDY_REFINERY_CHANNEL_ID', env('STARMAKER_REFINERY_CHANNEL_ID')),

    // RSI service status (status.robertsspaceindustries.com) is polled every
    // minute. New maintenance/outage notices go to this Discord channel;
    // empty = no Discord alerts (the web/client banners still work).
    'status_channel_id' => env('STARBUDDY_STATUS_CHANNEL_ID', env('STARMAKER_STATUS_CHANNEL_ID')),
    // Text placed above a fresh alert so it actually pings: "@here",
    // "@everyone" or a role mention like "<@&123456789>". Empty = no ping.
    'status_mention' => env('STARBUDDY_STATUS_MENTION', env('STARMAKER_STATUS_MENTION', '@here')),
    'status_url' => env('STARBUDDY_STATUS_URL', env('STARMAKER_STATUS_URL', 'https://status.robertsspaceindustries.com')),

    // Discord role id => org name. Members holding the role are attached to
    // the org on login. Format: JSON object, e.g. {"123456789":"Stellar Forge"}
    'role_org_map' => json_decode(env('STARBUDDY_ROLE_ORG_MAP', env('STARMAKER_ROLE_ORG_MAP', '{}')), true) ?: [],
];
