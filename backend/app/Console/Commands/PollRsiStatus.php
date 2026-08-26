<?php

namespace App\Console\Commands;

use App\Support\RsiStatus;
use Illuminate\Console\Command;

/**
 * Every-minute check of status.robertsspaceindustries.com. New incidents,
 * changed incidents and resolutions are alerted to Discord (when a status
 * channel is configured) and mirrored for the web/client banners.
 */
class PollRsiStatus extends Command
{
    protected $signature = 'starbuddy:poll-rsi-status';

    protected $description = 'Check the RSI status page for new or changed incidents and alert players';

    public function handle(): int
    {
        try {
            $alerts = RsiStatus::poll();
        } catch (\Throwable $e) {
            $this->error('RSI status poll failed: '.$e->getMessage());

            return self::FAILURE;
        }

        foreach ($alerts as [$kind, $slug]) {
            $this->info(sprintf('%-8s %s', $kind, $slug));
        }
        if ($alerts === []) {
            $this->line('No changes.');
        }

        return self::SUCCESS;
    }
}
