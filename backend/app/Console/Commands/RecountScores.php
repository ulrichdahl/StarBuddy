<?php

namespace App\Console\Commands;

use App\Support\Scoring;
use Illuminate\Console\Command;

/** Re-score every stored Game.log event by the rules in config/scoring.php. */
class RecountScores extends Command
{
    protected $signature = 'score:recount {--user= : Only this user id}';

    protected $description = 'Recount leaderboard points from the stored Game.log events';

    public function handle(): int
    {
        $count = Scoring::recount($this->option('user') ? (int) $this->option('user') : null);
        $this->info("{$count} scoring events by rules version ".config('scoring.version').'.');

        return self::SUCCESS;
    }
}
