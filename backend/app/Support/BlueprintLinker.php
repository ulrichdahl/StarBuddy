<?php

namespace App\Support;

use App\Models\Blueprint;
use App\Models\BlueprintOwned;
use Illuminate\Support\Str;

/**
 * Links owned-blueprint rows to recipes: by canonical item class first,
 * then by unambiguous name, then by the quoted stock name that survives
 * localization-pack renames (`STL-1C "SonicLite"`). Runs after every
 * recipe sync AND after every log ingest, so fresh instances don't wait
 * a day for the scheduled sync to make their blueprints usable.
 */
class BlueprintLinker
{
    /** @return int rows linked */
    public static function linkUnlinked(?int $userId = null): int
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
        BlueprintOwned::whereNull('blueprint_id')
            ->when($userId !== null, fn ($q) => $q->where('user_id', $userId))
            ->chunkById(500, function ($rows) use ($byClass, $byName, &$linked) {
                foreach ($rows as $owned) {
                    $id = ($owned->item_class ? $byClass[Blueprint::normalizeClass($owned->item_class)] ?? null : null)
                        ?? $byName[Str::lower($owned->blueprint_name)]
                        ?? self::matchQuoted($owned->blueprint_name, $byName);
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
    private static function matchQuoted(string $name, $byName): ?int
    {
        if (preg_match_all('/"([^"]+)"/', $name, $m) && $m[1]) {
            return $byName[Str::lower(end($m[1]))] ?? null;
        }

        return null;
    }
}
