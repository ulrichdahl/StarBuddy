<?php

namespace App\Jobs;

use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Http;

/**
 * Deliver an embed to one member as a Discord direct message, through the
 * bot's notify server (POST /notify with user_id instead of channel_id).
 * A member who blocks DMs from server members simply doesn't get it: the
 * bot answers 200 with delivered=false, which is not retried.
 */
class NotifyDiscordUser implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public function __construct(public string $discordId, public array $embed) {}

    public function handle(): void
    {
        Http::withToken(config('starbuddy.bot_api_token'))
            ->timeout(10)
            ->post(config('starbuddy.bot_notify_url'), [
                'user_id' => $this->discordId,
                'embed' => $this->embed,
            ])
            ->throw();
    }
}
