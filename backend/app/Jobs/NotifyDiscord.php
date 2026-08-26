<?php

namespace App\Jobs;

use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Http;

/**
 * Deliver an embed to a Discord channel through the bot's notify server
 * (POST /notify, shared bearer token). An optional plain `content` line
 * goes above the embed — that is where @here / role mentions live, since
 * mentions inside embeds never ping anyone. Queued so ingest never waits
 * on Discord; retried a few times if the bot is restarting.
 */
class NotifyDiscord implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public function __construct(public string $channelId, public array $embed, public ?string $content = null) {}

    public function handle(): void
    {
        Http::withToken(config('starmaker.bot_api_token'))
            ->timeout(10)
            ->post(config('starmaker.bot_notify_url'), [
                'channel_id' => $this->channelId,
                'embed' => $this->embed,
                'content' => $this->content,
            ])
            ->throw();
    }
}
