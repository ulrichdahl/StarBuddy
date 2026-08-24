<?php

return [
    // The Discord server (guild) this instance belongs to. Only members of
    // this guild can sign in. Everything community-specific hangs off this.
    'home_guild_id' => env('STARMAKER_HOME_GUILD_ID'),

    // Bearer token shared with the bot container for the internal /api/bot API.
    'bot_api_token' => env('STARMAKER_BOT_API_TOKEN'),

    // Where the backend delivers Discord notifications (the bot's notify endpoint).
    'bot_notify_url' => env('STARMAKER_BOT_NOTIFY_URL', 'http://bot:3000/notify'),

    // Discord role id => org name. Members holding the role are attached to
    // the org on login. Format: JSON object, e.g. {"123456789":"Stellar Forge"}
    'role_org_map' => json_decode(env('STARMAKER_ROLE_ORG_MAP', '{}'), true) ?: [],
];
