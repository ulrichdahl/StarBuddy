<?php

namespace App\Console\Commands;

use App\Models\ResourceType;
use Illuminate\Console\Command;

/**
 * Copy the quality-band reference (database/data/quality-bands.json) onto
 * resource_types.
 *
 * The bands come out of the game's own DataCore, where every material has a
 * fixed ladder of eight qualities and a terminal never shows a value off it.
 * That makes them worth taking literally: the entry grids only offer known
 * bands, so a wrong one is a quality a player physically cannot record.
 *
 * This used to scrape the Ore_quality page on starcitizen.tools and merge what
 * it found with values learned from entries. Checked against the 4.10 DataCore
 * that left eighteen materials wrong and five empty — Gold's ladder started at
 * 359 where the game says 264, and a real Levski capture printed 264 — because
 * a union can add a band but can never correct one. The file wins outright now.
 *
 * Re-run after editing the JSON for a game patch.
 */
class SyncQualityBands extends Command
{
    protected $signature = 'starbuddy:sync-quality-bands';

    protected $description = 'Set per-resource quality bands from database/data/quality-bands.json';

    private const FILE = 'data/quality-bands.json';

    /**
     * What dismantling a piece of looted, world-spawned gear returns.
     *
     * It is not a mined quality and so is in no material's ladder, but it is
     * the commonest quality a crafting material is actually held at, so every
     * material craft ingredients are drawn from carries it alongside its own
     * bands. Only those two categories: an ore is never a dismantle return.
     */
    private const DISMANTLE_QUALITY = 500;

    private const CRAFTING_CATEGORIES = ['refined', 'gem'];

    public function handle(): int
    {
        $path = database_path(self::FILE);
        $reference = json_decode((string) file_get_contents($path), true);
        if (! is_array($reference) || ! isset($reference['materials'])) {
            $this->error("Could not read {$path}.");

            return self::FAILURE;
        }

        $seen = [];
        $updated = 0;
        $missing = [];

        foreach ($reference['materials'] as $material) {
            // A material covers its refined self and its unrefined variants:
            // "Gold" and "Gold (Ore)", "Corundum" and "Corundum (Raw)".
            // Refining preserves quality through the primary ingredient, so
            // they share one ladder. `also` carries the few the game spells
            // differently, like "Raw Silicon".
            $names = [$material['name'], ...($material['also'] ?? [])];
            $types = ResourceType::query()
                ->where(function ($q) use ($names) {
                    foreach ($names as $name) {
                        $q->orWhereRaw('LOWER(name) = ?', [strtolower($name)])
                            ->orWhereLike('name', "{$name} (%", caseSensitive: false);
                    }
                })
                ->get();

            if ($types->isEmpty()) {
                $missing[] = $material['name'];
                continue;
            }

            foreach ($types as $type) {
                $seen[] = $type->id;
                $type->update(['known_qualities' => $this->ladder($material['bands'], $type)]);
                $updated++;
            }
        }

        // Crafting materials the game has no ladder for — Steel, Diamond,
        // Inert Materials — are still dismantle returns, so they get that one
        // quality. Whatever they had learned from entries stays: it is all the
        // evidence there is for them.
        $added = 0;
        foreach (ResourceType::whereIn('category', self::CRAFTING_CATEGORIES)->whereNotIn('id', $seen)->get() as $type) {
            $bands = $type->known_qualities ?? [];
            if (in_array(self::DISMANTLE_QUALITY, $bands, true)) {
                continue;
            }
            $type->update(['known_qualities' => $this->ladder($bands, $type)]);
            $added++;
        }

        $patch = $reference['_meta']['patch'] ?? '?';
        $this->info("Quality bands set on {$updated} resource types (patch {$patch}), and the dismantle quality added to {$added} more.");
        if ($missing) {
            $this->warn('No resource type for: '.implode(', ', $missing).' — run starbuddy:sync-resource-types first.');
        }

        return self::SUCCESS;
    }

    /**
     * The ladder a row should hold: the game's bands, plus the dismantle
     * quality when the row is something gear is crafted from.
     *
     * @param  int[]  $bands
     * @return int[]
     */
    private function ladder(array $bands, ResourceType $type): array
    {
        if (in_array($type->category, self::CRAFTING_CATEGORIES, true)) {
            $bands[] = self::DISMANTLE_QUALITY;
        }

        return collect($bands)->unique()->sort()->values()->all();
    }
}
