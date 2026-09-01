<?php

namespace App\Support;

use App\Models\Blueprint;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * How material quality moves a crafted item's stats.
 *
 * A recipe is a set of slots ("requirement groups": Frame, Barrel, Cycler,
 * …). Each slot takes one material and declares the item properties that
 * material's quality modifies, as a multiplier that interpolates across the
 * quality range — e.g. the CQ7's barrel scales `weapon_firerate` from ×0.88
 * at quality 0 to ×1.12 at quality 1000. A property touched by several slots
 * multiplies their factors together, and the crafted value is the default
 * value times that product.
 *
 * Only the wiki's blueprint *detail* route carries the groups, so they are
 * fetched per blueprint and cached on the row (same lazy pattern as
 * WikiItem). The live per-selection arithmetic also exists in the frontend
 * (see `frontend/src/lib/craftModifiers.ts`) — keep the two in step.
 */
class CraftModifiers
{
    /** Bump when the cached shape changes; older rows re-fetch on next open. */
    public const VERSION = 1;

    /** Fields worth keeping off each modifier. */
    private const MODIFIER_KEYS = [
        'property_key', 'label', 'better_when', 'quality_range',
        'modifier_range', 'value_range_type', 'value_segments',
    ];

    /** The groups of a cached payload, or [] when nothing is cached yet. */
    public static function groups(?array $payload): array
    {
        return $payload['groups'] ?? [];
    }

    /**
     * One-time fetch of a recipe's slots and their modifiers; true when a
     * request was made. An empty group list marks "fetched, nothing there"
     * so we never refetch.
     */
    public static function enrich(Blueprint $blueprint): bool
    {
        $cached = $blueprint->requirement_groups;
        if (is_array($cached) && ($cached['v'] ?? 0) >= self::VERSION) {
            return false;
        }
        if (! $blueprint->uuid) {
            return false;
        }

        try {
            $data = Http::acceptJson()->timeout(15)
                ->get("https://api.star-citizen.wiki/api/v2/blueprints/{$blueprint->uuid}")
                ->json('data');
        } catch (\Throwable) {
            return true; // offline or wiki hiccup — retry on next open
        }
        if (! is_array($data)) {
            return true;
        }

        $blueprint->update(['requirement_groups' => self::payload($data)]);

        return true;
    }

    /** Prune a wiki blueprint payload down to the slots and their modifiers. */
    public static function payload(array $data): array
    {
        $groups = collect($data['requirement_groups'] ?? [])->map(function (array $g) {
            // Every group in the game data holds exactly one material.
            $child = $g['children'][0] ?? [];

            return [
                'key' => $g['key'] ?? null,
                'name' => $g['name'] ?? null,
                'material' => $child['name'] ?? null,
                'kind' => $child['kind'] ?? null,
                'min_quality' => $child['min_quality'] ?? null,
                'modifiers' => collect($g['modifiers'] ?? [])
                    ->map(fn (array $m) => array_intersect_key($m, array_flip(self::MODIFIER_KEYS)))
                    ->values()->all(),
            ];
        })->values()->all();

        return ['v' => self::VERSION, 'groups' => $groups];
    }

    /**
     * The multiplier one modifier applies at a material quality, or null
     * when the game data does not say (power pips step in integers the wiki
     * API does not expose).
     */
    public static function multiplier(array $modifier, ?int $quality): ?float
    {
        if ($quality === null || ($modifier['value_range_type'] ?? null) === 'linear_integer_additive') {
            return null;
        }

        $segments = $modifier['value_segments'] ?? null;
        if (is_array($segments) && $segments !== []) {
            $first = $segments[0];
            if ($quality <= ($first['quality_min'] ?? 0)) {
                return (float) $first['modifier_at_start'];
            }
            foreach ($segments as $s) {
                if ($quality <= ($s['quality_max'] ?? 1000)) {
                    return self::lerp($s['quality_min'], $s['quality_max'], $s['modifier_at_start'], $s['modifier_at_end'], $quality);
                }
            }
            $last = $segments[count($segments) - 1];

            return (float) $last['modifier_at_end'];
        }

        $min = $modifier['modifier_range']['at_min_quality'] ?? null;
        $max = $modifier['modifier_range']['at_max_quality'] ?? null;
        if ($min === null || $max === null) {
            return null;
        }

        return self::lerp(
            $modifier['quality_range']['min'] ?? 0,
            $modifier['quality_range']['max'] ?? 1000,
            $min, $max, $quality,
        );
    }

    /**
     * property_key → multiplier, for a set of material qualities keyed by
     * lowercased material name. Slots whose material has no known quality
     * are skipped (they contribute ×1).
     */
    public static function factors(?array $payload, array $qualityByMaterial): array
    {
        $factors = [];
        foreach (self::groups($payload) as $group) {
            $quality = $qualityByMaterial[Str::lower((string) $group['material'])] ?? null;
            foreach ($group['modifiers'] ?? [] as $modifier) {
                $f = self::multiplier($modifier, $quality === null ? null : (int) round($quality));
                if ($f === null) {
                    continue;
                }
                $key = $modifier['property_key'];
                $factors[$key] = ($factors[$key] ?? 1.0) * $f;
            }
        }

        return $factors;
    }

    /**
     * property_key → [worst, best] multiplier: what crafting can do to each
     * stat, from the worst to the best material in every slot.
     */
    public static function extremes(?array $payload): array
    {
        $out = [];
        foreach (self::groups($payload) as $group) {
            foreach ($group['modifiers'] ?? [] as $modifier) {
                $ends = self::ends($modifier);
                if ($ends === null) {
                    continue;
                }
                $key = $modifier['property_key'];
                [$lo, $hi] = $out[$key] ?? [1.0, 1.0];
                $out[$key] = [$lo * $ends[0], $hi * $ends[1]];
            }
        }

        return $out;
    }

    /** The lowest and highest multiplier a modifier can reach. */
    private static function ends(array $modifier): ?array
    {
        if (($modifier['value_range_type'] ?? null) === 'linear_integer_additive') {
            return null;
        }
        $segments = $modifier['value_segments'] ?? null;
        if (is_array($segments) && $segments !== []) {
            $values = [];
            foreach ($segments as $s) {
                $values[] = (float) $s['modifier_at_start'];
                $values[] = (float) $s['modifier_at_end'];
            }

            return [min($values), max($values)];
        }
        $min = $modifier['modifier_range']['at_min_quality'] ?? null;
        $max = $modifier['modifier_range']['at_max_quality'] ?? null;
        if ($min === null || $max === null) {
            return null;
        }

        return [min($min, $max), max($min, $max)];
    }

    private static function lerp(float|int $qMin, float|int $qMax, float|int $vMin, float|int $vMax, float|int $q): float
    {
        if ($qMax <= $qMin) {
            return (float) $vMax;
        }
        $t = max(0.0, min(1.0, ($q - $qMin) / ($qMax - $qMin)));

        return (float) $vMin + ($vMax - $vMin) * $t;
    }
}
