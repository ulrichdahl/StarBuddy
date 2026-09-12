<?php

namespace App\Console\Commands;

use App\Models\Blueprint;
use App\Models\BlueprintPool;
use App\Models\BlueprintPoolEntry;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Load the blueprint reward pools (database/data/blueprint-pools.json) — which
 * missions hand out which recipes.
 *
 * The file comes out of the game's own DataCore, where a mission's contract
 * definition names a pool and the pool lists its blueprints with a weight. The
 * wiki API has no notion of any of this, which is why it ships as a file rather
 * than being fetched: see scripts/extract-blueprint-pools.py for how to
 * regenerate it after a patch.
 *
 * Pools are matched to recipes on the blueprint key, case-insensitively — the
 * DataCore writes bp_craft_amrs_lasercannon_s1 where the wiki writes
 * BP_CRAFT_AMRS_LaserCannon_S1. A pool naming a recipe the wiki has not
 * published keeps its key and waits for it.
 */
class SyncBlueprintPools extends Command
{
    protected $signature = 'starbuddy:sync-blueprint-pools';

    protected $description = 'Load blueprint reward pools and their missions from database/data/blueprint-pools.json';

    private const FILE = 'data/blueprint-pools.json';

    public function handle(): int
    {
        $path = database_path(self::FILE);
        $data = json_decode((string) @file_get_contents($path), true);
        if (! is_array($data) || ! isset($data['pools'])) {
            $this->error("Could not read {$path}.");

            return self::FAILURE;
        }

        $ids = Blueprint::whereNotNull('key')->pluck('id', 'key')
            ->mapWithKeys(fn ($id, $key) => [strtolower($key) => $id]);

        $pools = 0;
        $entries = 0;
        $unpublished = [];

        DB::transaction(function () use ($data, $ids, &$pools, &$entries, &$unpublished) {
            $kept = [];
            foreach ($data['pools'] as $pool) {
                $row = BlueprintPool::updateOrCreate(
                    ['key' => strtolower($pool['key'])],
                    ['record' => $pool['record'] ?? null, 'sources' => $pool['sources'] ?? []],
                );
                $kept[] = $row->id;
                $pools++;

                $keys = [];
                foreach ($pool['blueprints'] ?? [] as $entry) {
                    $key = strtolower($entry['key']);
                    $keys[] = $key;
                    BlueprintPoolEntry::updateOrCreate(
                        ['blueprint_pool_id' => $row->id, 'blueprint_key' => $key],
                        ['blueprint_id' => $ids[$key] ?? null, 'weight' => $entry['weight'] ?? 1],
                    );
                    $entries++;
                    if (! isset($ids[$key])) {
                        $unpublished[] = $key;
                    }
                }
                // A patch can take a blueprint out of a pool.
                $row->entries()->whereNotIn('blueprint_key', $keys)->delete();
            }
            // And it can retire a pool outright.
            BlueprintPool::whereNotIn('id', $kept)->delete();
        });

        $this->info("Synced {$pools} pools and {$entries} blueprint entries.");
        if ($unpublished !== []) {
            $count = count(array_unique($unpublished));
            $this->warn("{$count} pooled blueprints are not in the recipe catalogue yet: "
                .implode(', ', array_slice(array_unique($unpublished), 0, 5)).'…');
        }

        return self::SUCCESS;
    }
}
