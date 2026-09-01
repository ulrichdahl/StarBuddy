<?php

namespace App\Support;

/**
 * Maps a wiki items-API payload (the same shape from /items/{uuid} and the
 * /items listing) onto the blueprint columns we cache: lore, image,
 * manufacturer, classification, and the pruned stat blocks the craft
 * modal renders.
 */
class WikiItem
{
    /** Stat blocks worth caching, per item type; absent keys are skipped. */
    public const STAT_BLOCKS = [
        'personal_weapon', 'vehicle_weapon', 'clothing', 'shield',
        'power_plant', 'cooler', 'quantum_drive', 'radar', 'tractor_beam',
        'mining_laser', 'salvage_modifier', 'weapon_attachment', 'melee',
        'temperature_resistance', 'radiation_resistance', 'inventory',
        'durability',
    ];

    // Bump when the captured shape changes — rows with an older (or no)
    // marker re-fetch on next open.
    public const STATS_VERSION = 3;

    public static function attributes(array $item): array
    {
        $stats = [];
        foreach (self::STAT_BLOCKS as $key) {
            if (! empty($item[$key]) && is_array($item[$key])) {
                $stats[$key] = self::pruneStats($item[$key]);
            }
        }

        $undefined = fn ($v) => ($v === null || $v === '' || strcasecmp((string) $v, 'undefined') === 0) ? null : $v;

        return [
            'description' => $item['description']['en_EN'] ?? '',
            'image_url' => $item['images'][0]['thumbnail_url'] ?? $item['images'][0]['original_url'] ?? null,
            'manufacturer' => $item['manufacturer']['name'] ?? null,
            'item_uuid' => $item['uuid'] ?? null,
            'type_label' => $undefined($item['type_label'] ?? null),
            'sub_type_label' => $undefined($item['sub_type_label'] ?? null),
            'classification' => $undefined($item['classification'] ?? null),
            'component_class' => $undefined($item['class'] ?? null),
            'item_meta' => array_filter([
                'mass' => $item['mass'] ?? null,
                'size' => $item['size'] ?? null,
                'item_grade' => $item['grade'] ?? null,
                'classification' => $item['classification_label'] ?? null,
                'stats' => $stats ?: null,
            ]) + ['stats_v' => self::STATS_VERSION],
        ];
    }

    /**
     * The wiki blocks carry dozens of nulls and some huge sub-trees the UI
     * never shows — drop those, and boil ammunition down to what matters.
     */
    private static function pruneStats(array $block): array
    {
        unset($block['damages'], $block['magazine_volume'], $block['ads_spread'],
            $block['damage_resistance'], $block['protected_body_parts'],
            $block['spline_jump'], $block['standard_jump']);

        if (isset($block['ammunition']) && is_array($block['ammunition'])) {
            $ammo = $block['ammunition'];
            $block['ammunition'] = array_filter([
                'speed' => $ammo['speed'] ?? null,
                'range' => $ammo['range'] ?? null,
                'size' => $ammo['size'] ?? null,
            ], fn ($v) => $v !== null);
        }

        // Fire / jump modes: keep only what the stats panel renders.
        if (isset($block['modes']) && is_array($block['modes'])) {
            $keep = array_flip([
                'mode', 'localised', 'type', 'rpm', 'ammo_per_shot',
                'pellets_per_shot', 'damage_per_second', 'shot_count',
                'drive_speed', 'drive_speed_formatted', 'cooldown_time', 'spool_up_time',
            ]);
            $block['modes'] = array_values(array_map(
                fn ($m) => is_array($m) ? array_intersect_key($m, $keep) : $m,
                $block['modes'],
            ));
        }

        return self::pruneNulls($block);
    }

    private static function pruneNulls(array $arr): array
    {
        $out = [];
        foreach ($arr as $k => $v) {
            if (is_array($v)) {
                $v = self::pruneNulls($v);
                if ($v === []) {
                    continue;
                }
            }
            if ($v !== null) {
                $out[$k] = $v;
            }
        }

        return $out;
    }

    /**
     * One-time fetch of the output item's lore and stat blocks for rows the
     * bulk item sync hasn't covered yet, cached on the row ('' description
     * marks "fetched, nothing there" so we never refetch).
     */
    public static function enrich(\App\Models\Blueprint $blueprint): void
    {
        $upToDate = $blueprint->description !== null
            && ($blueprint->item_meta['stats_v'] ?? 0) >= self::STATS_VERSION;
        if ($upToDate || ! $blueprint->uuid) {
            return;
        }

        $data = ['description' => ''];
        try {
            $itemUuid = $blueprint->item_uuid
                ?? \Illuminate\Support\Facades\Http::acceptJson()->timeout(15)
                    ->get("https://api.star-citizen.wiki/api/v2/blueprints/{$blueprint->uuid}")
                    ->json('data.output_item_uuid');

            if ($itemUuid) {
                $item = \Illuminate\Support\Facades\Http::acceptJson()->timeout(15)
                    ->get("https://api.star-citizen.wiki/api/v2/items/{$itemUuid}")
                    ->json('data');
                if (is_array($item)) {
                    $data = self::attributes($item);
                }
            }
        } catch (\Throwable) {
            // Offline or wiki hiccup — leave description null to retry later.
            return;
        }

        $blueprint->update($data);
    }
}
