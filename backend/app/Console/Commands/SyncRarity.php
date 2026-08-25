<?php

namespace App\Console\Commands;

use App\Models\ResourceType;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Derive resource rarity from spawn data: the wiki's commodity details list
 * every mining location with group/relative spawn probabilities. A
 * resource's prevalence is the summed expected occurrence across locations;
 * percentile-ranking prevalences yields the rarity ladder. Refined
 * materials inherit from their (Ore)/(Raw) variants.
 */
class SyncRarity extends Command
{
    protected $signature = 'starbuddy:sync-rarity';

    // Pre-rename name, kept so old habits and scripts keep working.
    protected $aliases = ['starmaker:sync-rarity'];

    protected $description = 'Derive resource rarity from wiki mining spawn probabilities';

    private const API = 'https://api.star-citizen.wiki/api/commodities';

    public function handle(): int
    {
        // Full commodity list (uuid + kind) — paginate.
        $commodities = [];
        $page = 1;
        do {
            $response = Http::acceptJson()->retry(3, 2000)->timeout(30)
                ->get(self::API, ['limit' => 100, 'page' => $page]);
            if (! $response->successful()) {
                $this->error("Commodities list returned {$response->status()}");

                return self::FAILURE;
            }
            foreach ($response->json('data', []) as $c) {
                $commodities[] = $c;
            }
            $hasMore = (bool) $response->json('links.next');
            $page++;
        } while ($hasMore);

        // Prevalence per commodity that has spawn locations.
        $prevalence = [];
        foreach ($commodities as $c) {
            if (! in_array($c['kind'] ?? null, ['mineable', 'harvestable'], true)) {
                continue;
            }
            $detail = Http::acceptJson()->retry(3, 2000)->timeout(30)
                ->get(self::API.'/'.$c['uuid']);
            if (! $detail->successful()) {
                continue;
            }
            $locations = $detail->json('data.locations', []);
            if (empty($locations)) {
                continue;
            }
            $score = 0.0;
            foreach ($locations as $loc) {
                $score += ((float) ($loc['group_probability'] ?? 0))
                    * ((float) ($loc['relative_probability'] ?? 1));
            }
            if ($score > 0) {
                $prevalence[$c['name']] = $score;
            }
            usleep(150_000);
        }

        if (count($prevalence) < 5) {
            $this->error('Too little spawn data to rank ('.count($prevalence).' resources).');

            return self::FAILURE;
        }

        // Percentile rank → rarity tier. Rarest tenth is legendary.
        asort($prevalence);
        $ranked = array_keys($prevalence);
        $n = count($ranked);
        $tierFor = function (int $index) use ($n): string {
            $p = $index / $n;

            return match (true) {
                $p < 0.10 => 'legendary',
                $p < 0.25 => 'epic',
                $p < 0.45 => 'rare',
                $p < 0.70 => 'uncommon',
                default => 'common',
            };
        };

        $updated = 0;
        foreach ($ranked as $i => $name) {
            $rarity = $tierFor($i);
            // The spawning commodity, and the refined material it becomes.
            $base = trim(preg_replace('/\s*\((Ore|Raw)\)$/i', '', $name));
            foreach (array_unique([$name, $base]) as $candidate) {
                $type = ResourceType::whereLike('name', $candidate, caseSensitive: false)->first();
                if ($type && ($type->rarity === null || $type->spawn_score === null
                    || $type->spawn_score > $prevalence[$name] || $candidate === $name)) {
                    $type->update(['rarity' => $rarity, 'spawn_score' => $prevalence[$name]]);
                    $updated++;
                }
            }
        }

        $this->info("Ranked {$n} spawning resources; updated {$updated} resource types.");

        return self::SUCCESS;
    }
}
