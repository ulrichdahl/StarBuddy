<?php

namespace App\Console\Commands;

use App\Models\Location;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;

/**
 * Sync the shared location catalog (cities and space stations — the places
 * with habs where members actually store things) from the SC Trade Tools
 * open API (https://sc-trade.tools), grouped by star system.
 */
class SyncLocations extends Command
{
    protected $signature = 'starmaker:sync-locations';

    protected $description = 'Sync shared locations (cities, stations) from the SC Trade Tools API';

    private const API = 'https://sc-trade.tools/api/locations';

    private const KINDS = [
        'City' => 'landing_zone',
        'Space station' => 'station',
    ];

    public function handle(): int
    {
        $response = Http::acceptJson()->retry(3, 2000)->timeout(30)->get(self::API);

        if (! $response->successful()) {
            $this->error("SC Trade Tools API returned {$response->status()}");

            return self::FAILURE;
        }

        $synced = 0;
        foreach ($response->json() as $row) {
            $kind = self::KINDS[$row['type'] ?? ''] ?? null;
            if ($kind === null) {
                continue;
            }

            $path = array_map('trim', explode('>', $row['name']));
            $name = end($path);
            $system = $path[0];

            // Space-insensitive match: the API says "Grim HEX", players (and
            // our seed) say "GrimHEX" — one location, not two.
            $existing = Location::whereNull('user_id')->whereNull('org_id')
                ->whereRaw("replace(lower(name), ' ', '') = ?", [str_replace(' ', '', mb_strtolower($name))])
                ->first();

            if ($existing) {
                $existing->update(['kind' => $existing->kind === 'landing_zone' ? 'landing_zone' : $kind, 'system' => $system]);
            } else {
                Location::create(['name' => $name, 'kind' => $kind, 'system' => $system]);
            }
            $synced++;
        }

        $this->info("Synced {$synced} shared locations.");

        return self::SUCCESS;
    }
}
