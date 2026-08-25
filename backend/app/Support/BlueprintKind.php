<?php

namespace App\Support;

use App\Models\Blueprint;
use Illuminate\Support\Str;

/**
 * Human labels for the wiki's raw item type codes: "Char_Armor_Undersuit"
 * becomes "Armor · Undersuit", a BroadSpec radar "Radar · Industrial".
 * Category comes from the type code alone (so the filter list works without
 * item data); the kind prefers the component class, then the item's own
 * sub-type label, then the armor slot baked into the type code.
 */
class BlueprintKind
{
    private const CATEGORIES = [
        'WeaponPersonal' => 'Weapon',
        'WeaponGun' => 'Ship Weapon',
        'WeaponMining' => 'Mining Laser',
        'WeaponAttachment' => 'Attachment',
        'PowerPlant' => 'Power Plant',
        'QuantumDrive' => 'Quantum Drive',
        'TractorBeam' => 'Tractor Beam',
        'SalvageModifier' => 'Salvage Modifier',
        'SalvageHead' => 'Salvage Head',
        'DockingCollar' => 'Docking Collar',
    ];

    /** Type-code prefixes / codes → filter group. Order here is display order. */
    private const GROUPS = [
        'vehicle_components' => ['label' => 'Vehicle components', 'types' => ['PowerPlant', 'Cooler', 'Shield', 'QuantumDrive', 'Radar', 'DockingCollar', 'Cargo']],
        'vehicle_weapons' => ['label' => 'Vehicle weapons & tools', 'types' => ['WeaponGun', 'WeaponMining', 'TractorBeam', 'SalvageHead', 'SalvageModifier']],
        'character_armor' => ['label' => 'Character armor', 'prefix' => 'Char_Armor_'],
        'character_clothing' => ['label' => 'Character clothing', 'prefix' => 'Char_Clothing_'],
        'character_weapons' => ['label' => 'Character weapons', 'types' => ['WeaponPersonal', 'WeaponAttachment']],
        'other' => ['label' => 'Other', 'types' => []],
    ];

    /** Group key for a type code ("PowerPlant" → "vehicle_components"). */
    public static function group(?string $type): string
    {
        foreach (self::GROUPS as $key => $g) {
            if (isset($g['prefix']) && $type !== null && str_starts_with($type, $g['prefix'])) {
                return $key;
            }
            if (in_array($type, $g['types'] ?? [], true)) {
                return $key;
            }
        }

        return 'other';
    }

    public static function groupLabel(string $key): string
    {
        return self::GROUPS[$key]['label'] ?? Str::headline($key);
    }

    /**
     * The type filter as groups: [{key, label, types: [{value, label}]}],
     * groups in display order, types sorted by label; empty groups omitted.
     */
    public static function groupedTypes(iterable $types): array
    {
        $out = [];
        foreach (self::GROUPS as $key => $g) {
            $out[$key] = ['key' => $key, 'label' => $g['label'], 'types' => []];
        }
        foreach ($types as $type) {
            $out[self::group($type)]['types'][] = ['value' => $type, 'label' => self::typeLabel($type)];
        }
        foreach ($out as &$g) {
            usort($g['types'], fn ($a, $b) => strcmp($a['label'], $b['label']));
        }

        return array_values(array_filter($out, fn ($g) => $g['types'] !== []));
    }

    public static function category(?string $type): ?string
    {
        if ($type === null) {
            return null;
        }
        if (str_starts_with($type, 'Char_Armor_')) {
            return 'Armor';
        }
        if (str_starts_with($type, 'Char_Clothing_')) {
            return 'Clothing';
        }

        return self::CATEGORIES[$type] ?? Str::headline($type);
    }

    /** Filter label for a raw type code: "Armor · Torso", "Power Plant". */
    public static function typeLabel(string $type): string
    {
        $category = self::category($type);
        if (str_starts_with($type, 'Char_')) {
            $slot = Str::after(preg_replace('/_\d+$/', '', Str::after($type, '_')), '_');

            return $slot !== '' ? "{$category} · {$slot}" : $category;
        }

        return $category;
    }

    /**
     * Resolve a free-text term ("shield", "powerplant", "undersuit",
     * "quantum drive") to the blueprint type codes it covers. Matches the
     * category, the armor/clothing slot, or the raw type code — case,
     * spaces, hyphens and a plural s are ignored. Null when it isn't one.
     *
     * @return array{label: string, types: list<string>}|null
     */
    public static function matchCategory(string $term, iterable $types): ?array
    {
        $norm = fn (string $s) => rtrim(preg_replace('/[^a-z0-9]/', '', strtolower($s)), 's');
        $q = $norm($term);
        if ($q === '') {
            return null;
        }

        $byCategory = [];
        $bySlot = [];
        foreach ($types as $type) {
            $category = self::category($type) ?? '';
            $byCategory[$norm($category)][] = $type;
            $byCategory[$norm($type)][] = $type;
            $label = self::typeLabel($type);
            if ($label !== $category) {
                $bySlot[$norm(Str::afterLast($label, '·'))] = ['label' => $label, 'types' => [$type]];
                $byCategory[$norm($label)][] = $type;
            }
        }

        if (isset($byCategory[$q])) {
            $matched = array_values(array_unique($byCategory[$q]));

            return ['label' => self::category($matched[0]) ?? $term, 'types' => $matched];
        }
        if (isset($bySlot[$q])) {
            return $bySlot[$q];
        }

        // Whole groups: "vehicle components" / "components", "character weapons" …
        $all = is_array($types) ? $types : iterator_to_array($types);
        foreach (self::GROUPS as $key => $g) {
            $names = [$norm($g['label']), $norm($key), $norm(Str::after($g['label'], ' '))];
            if (in_array($q, $names, true)) {
                $members = array_values(array_filter($all, fn ($t) => self::group($t) === $key));

                return $members ? ['label' => $g['label'], 'types' => $members] : null;
            }
        }

        return null;
    }

    public static function kind(Blueprint $bp): ?string
    {
        $type = $bp->type ?? '';

        // Armor and clothing: the slot lives in the type code
        // (Char_Armor_Undersuit, Char_Clothing_Torso_0).
        if (str_starts_with($type, 'Char_')) {
            $slot = preg_replace('/_\d+$/', '', Str::after($type, '_', ));
            $slot = Str::after($slot, '_');

            return $slot !== '' ? $slot : null;
        }

        // Weapons: the weapon type (HMG, Laser Cannon) from the stat block.
        $stats = $bp->item_meta['stats'] ?? [];
        if ($type === 'WeaponPersonal' && ! empty($stats['personal_weapon']['type'])) {
            return $stats['personal_weapon']['type'];
        }
        if ($type === 'WeaponGun' && ! empty($stats['vehicle_weapon']['type'])) {
            return $stats['vehicle_weapon']['type'];
        }

        // Ship components: Industrial / Military / Civilian / Stealth / Competition.
        if ($bp->component_class) {
            return $bp->component_class;
        }

        $sub = $bp->sub_type_label ?? $bp->sub_type;
        if ($sub === null || strcasecmp($sub, 'undefined') === 0) {
            return null;
        }

        return Str::headline($sub);
    }

    /** "Armor · Undersuit" — the category alone when no kind is known. */
    public static function label(Blueprint $bp): ?string
    {
        $category = self::category($bp->type);
        $kind = self::kind($bp);

        return $category === null ? $kind : ($kind === null || $kind === $category ? $category : "{$category} · {$kind}");
    }
}
