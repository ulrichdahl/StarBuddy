<?php

namespace App\Support;

use App\Models\Blueprint;

/**
 * The in-game fabrication kiosk's blueprint categories, in its order.
 *
 * Players browse their owned blueprints through the kiosk, so the website's
 * blueprint lists mirror it: Ammo · Armor (Arms, Backpacks, Core, Helmets,
 * Legs, Undersuits) · Other · Vehicles (Coolers, Mining, Power plants, …,
 * Weapons) · Weapons (Sidearms, Primary). Verified against kiosk screenshots
 * in screenshots/4.10.0-fabricator-blueprints-*.png (Alpha 4.10). The kiosk
 * does not split by armour weight or grade.
 */
class FabricatorCategory
{
    /** Category key → label and ordered subcategories (key → label). */
    public const CATEGORIES = [
        'ammo' => ['label' => 'Ammo', 'subs' => ['ammo' => 'Ammo']],
        'armor' => ['label' => 'Armor', 'subs' => [
            'arms' => 'Arms', 'backpacks' => 'Backpacks', 'core' => 'Core', 'helmets' => 'Helmets', 'legs' => 'Legs', 'undersuits' => 'Undersuits',
        ]],
        'other' => ['label' => 'Other', 'subs' => ['clothing' => 'Clothing', 'other' => 'Other']],
        'vehicles' => ['label' => 'Vehicles', 'subs' => [
            'coolers' => 'Coolers', 'mining' => 'Mining', 'power_plants' => 'Power plants', 'quantum_drives' => 'Quantum drives',
            'radar' => 'Radar', 'salvage' => 'Salvage', 'shields' => 'Shields', 'tractor_beams' => 'Tractor beams', 'weapons' => 'Weapons',
        ]],
        'weapons' => ['label' => 'Weapons', 'subs' => ['sidearms' => 'Sidearms', 'primary' => 'Primary']],
    ];

    /** Blueprint type → [category, subcategory]. */
    private const BY_TYPE = [
        'WeaponAttachment' => ['ammo', 'ammo'],
        'Char_Armor_Arms' => ['armor', 'arms'],
        'Char_Armor_Backpack' => ['armor', 'backpacks'],
        'Char_Armor_Torso' => ['armor', 'core'],
        'Char_Armor_Helmet' => ['armor', 'helmets'],
        'Char_Armor_Legs' => ['armor', 'legs'],
        'Char_Armor_Undersuit' => ['armor', 'undersuits'],
        'Cooler' => ['vehicles', 'coolers'],
        'WeaponMining' => ['vehicles', 'mining'],
        'PowerPlant' => ['vehicles', 'power_plants'],
        'QuantumDrive' => ['vehicles', 'quantum_drives'],
        'Radar' => ['vehicles', 'radar'],
        'SalvageHead' => ['vehicles', 'salvage'],
        'SalvageModifier' => ['vehicles', 'salvage'],
        'Shield' => ['vehicles', 'shields'],
        'TractorBeam' => ['vehicles', 'tractor_beams'],
        'WeaponGun' => ['vehicles', 'weapons'],
    ];

    /** @return array{0: string, 1: string} [category key, subcategory key] */
    public static function of(Blueprint $bp): array
    {
        $type = $bp->type ?? '';
        if ($type === 'WeaponPersonal') {
            return ['weapons', $bp->sub_type === 'Small' ? 'sidearms' : 'primary'];
        }
        if (str_starts_with($type, 'Char_Clothing_')) {
            return ['other', 'clothing'];
        }

        return self::BY_TYPE[$type] ?? ['other', 'other'];
    }

    /** "armor/helmets" — the value the category filter sends. */
    public static function key(Blueprint $bp): string
    {
        return implode('/', self::of($bp));
    }

    /** "Armor · Helmets" for display. */
    public static function label(string $category, string $sub): string
    {
        $c = self::CATEGORIES[$category] ?? null;
        if (! $c) {
            return ucfirst($category);
        }
        $subLabel = $c['subs'][$sub] ?? ucfirst($sub);

        return $subLabel === $c['label'] ? $c['label'] : "{$c['label']} · {$subLabel}";
    }

    /** Position in kiosk order, for sorting (category major, subcategory minor). */
    public static function order(string $category, string $sub): int
    {
        $ci = array_search($category, array_keys(self::CATEGORIES), true);
        $ci = $ci === false ? 99 : $ci;
        $si = array_search($sub, array_keys(self::CATEGORIES[$category]['subs'] ?? []), true);
        $si = $si === false ? 99 : $si;

        return $ci * 100 + $si;
    }

    /**
     * Filter options in kiosk order: each category with its subcategories.
     *
     * @return list<array{key: string, label: string, subs: list<array{key: string, label: string}>}>
     */
    public static function options(): array
    {
        $out = [];
        foreach (self::CATEGORIES as $key => $c) {
            $subs = [];
            foreach ($c['subs'] as $sk => $sl) {
                $subs[] = ['key' => "{$key}/{$sk}", 'label' => $sl];
            }
            $out[] = ['key' => $key, 'label' => $c['label'], 'subs' => $subs];
        }

        return $out;
    }

    /** Does a blueprint fall under a filter value ("armor" or "armor/helmets")? */
    public static function matches(Blueprint $bp, string $filter): bool
    {
        [$cat, $sub] = self::of($bp);
        [$fc, $fs] = array_pad(explode('/', $filter, 2), 2, null);

        return $cat === $fc && ($fs === null || $sub === $fs);
    }
}
