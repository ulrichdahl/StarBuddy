<?php

namespace App\Console\Commands;

use App\Models\Blueprint;
use App\Models\BlueprintOwned;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Sync the recipe database from the Star Citizen Wiki API
 * (https://api.star-citizen.wiki, CC-attributed community data), then link
 * members' owned blueprints to recipes by canonical item class (fallback:
 * exact name). Scheduled daily; run manually after a game patch.
 */
class SyncBlueprints extends Command
{
    protected $signature = 'starmaker:sync-blueprints {--page-size=100}';

    protected $description = 'Sync crafting recipes from the Star Citizen Wiki API and link owned blueprints';

    private const API = 'https://api.star-citizen.wiki/api/v2/blueprints';

    public function handle(): int
    {
        $page = 1;
        $synced = 0;

        do {
            $response = Http::acceptJson()
                ->retry(3, 2000)
                ->timeout(30)
                ->get(self::API, [
                    'page[size]' => (int) $this->option('page-size'),
                    'page[number]' => $page,
                ]);

            if (! $response->successful()) {
                $this->error("Wiki API returned {$response->status()} on page {$page}");

                return self::FAILURE;
            }

            foreach ($response->json('data', []) as $bp) {
                Blueprint::updateOrCreate(
                    ['uuid' => $bp['uuid']],
                    [
                        // A few internal entries (e.g. *_TEMP) have no output
                        // name; fall back to the class or blueprint key.
                        'name' => $bp['output_name']
                            ?? ($bp['output']['name'] ?? null)
                            ?? $bp['output_class']
                            ?? $bp['key']
                            ?? 'Unknown blueprint',
                        'key' => $bp['key'] ?? null,
                        'item_class' => $bp['output_class'] ?? null,
                        'type' => $bp['output']['type'] ?? null,
                        'sub_type' => $bp['output']['sub_type'] ?? null,
                        'grade' => $bp['output']['grade'] ?? null,
                        'is_default' => (bool) ($bp['is_available_by_default'] ?? false),
                        'craft_time_seconds' => $bp['craft_time_seconds'] ?? null,
                        'game_version' => $bp['game_version'] ?? null,
                        'tags' => array_values(array_filter([
                            $bp['output']['type_label'] ?? null,
                            $bp['output']['sub_type'] ?? null,
                            isset($bp['output']['grade']) ? 'Grade '.$bp['output']['grade'] : null,
                        ])),
                        'ingredients' => collect($bp['ingredients'] ?? [])->map(fn ($i) => [
                            'name' => $i['name'],
                            'kind' => $i['kind'],
                            // Storage units: integer mSCU for resources, pieces for items/gems.
                            'quantity_mscu' => isset($i['quantity_scu']) ? (int) round($i['quantity_scu'] * 1000) : null,
                            'quantity_pieces' => $i['quantity'] ?? null,
                        ])->all(),
                        'dismantle_returns' => $bp['dismantle_returns'] ?? null,
                    ],
                );
                $synced++;
            }

            $hasMore = (bool) $response->json('links.next');
            $page++;
            if ($hasMore) {
                usleep(250_000); // stay well under the API's rate limits
            }
        } while ($hasMore);

        $this->info("Synced {$synced} blueprints.");

        $linked = $this->linkOwned();
        $this->info("Linked {$linked} owned blueprints to recipes.");

        return self::SUCCESS;
    }

    private function linkOwned(): int
    {
        $byClass = Blueprint::whereNotNull('item_class')
            ->pluck('id', 'item_class')
            ->mapWithKeys(fn ($id, $class) => [Blueprint::normalizeClass($class) => $id]);

        // Names only count as identity when unambiguous.
        $byName = Blueprint::pluck('id', 'name')
            ->groupBy(fn ($id, $name) => Str::lower($name))
            ->filter(fn ($ids) => $ids->count() === 1)
            ->map(fn ($ids) => $ids->first());

        $linked = 0;
        BlueprintOwned::whereNull('blueprint_id')->chunkById(500, function ($rows) use ($byClass, $byName, &$linked) {
            foreach ($rows as $owned) {
                $id = ($owned->item_class ? $byClass[Blueprint::normalizeClass($owned->item_class)] ?? null : null)
                    ?? $byName[Str::lower($owned->blueprint_name)]
                    ?? $this->matchQuoted($owned->blueprint_name, $byName);
                if ($id) {
                    // Rows linked by name inherit the recipe's canonical class.
                    $owned->update([
                        'blueprint_id' => $id,
                        'item_class' => $owned->item_class ?? Blueprint::find($id)?->item_class,
                    ]);
                    $linked++;
                }
            }
        });

        return $linked;
    }

    // Localization packs rename components like `STL-1C "SonicLite"` — the
    // stock name survives inside the quotes.
    private function matchQuoted(string $name, $byName): ?int
    {
        if (preg_match_all('/"([^"]+)"/', $name, $m) && $m[1]) {
            return $byName[Str::lower(end($m[1]))] ?? null;
        }

        return null;
    }
}
