<?php

namespace Tests\Unit;

use App\Support\CraftModifiers;
use PHPUnit\Framework\TestCase;

/**
 * The reference numbers come from the wiki's 4.10.0 recipe data, cross-checked
 * against scmdb.net's fabricator for the same material qualities.
 */
class CraftModifiersTest extends TestCase
{
    /** A slot's modifier, in the wiki's shape. */
    private function modifier(string $key, float $atMin, float $atMax, string $betterWhen = 'higher'): array
    {
        return [
            'property_key' => $key,
            'label' => $key,
            'better_when' => $betterWhen,
            'quality_range' => ['min' => 0, 'max' => 1000],
            'modifier_range' => ['at_min_quality' => $atMin, 'at_max_quality' => $atMax],
            'value_range_type' => 'linear',
            'value_segments' => null,
        ];
    }

    private function group(string $name, string $material, array $modifiers): array
    {
        return ['key' => strtoupper($name), 'name' => $name, 'material' => $material, 'kind' => 'resource', 'min_quality' => 0, 'modifiers' => $modifiers];
    }

    /** The CQ7 Rifle: Aluminum frame, Hephaestanite stock, Iron barrel. */
    public function test_cq7_rifle_factors(): void
    {
        $recoil = fn () => [
            $this->modifier('weapon_recoil_smoothness', 1.2, 0.8, 'lower'),
            $this->modifier('weapon_recoil_handling', 1.2, 0.8, 'lower'),
            $this->modifier('weapon_recoil_kick', 1.2, 0.8, 'lower'),
        ];
        $payload = ['v' => CraftModifiers::VERSION, 'groups' => [
            $this->group('Frame', 'Aluminum', $recoil()),
            $this->group('Stock', 'Hephaestanite', $recoil()),
            $this->group('Barrel', 'Iron', [
                $this->modifier('weapon_damage', 0.925, 1.075),
                $this->modifier('weapon_firerate', 0.88, 1.12),
            ]),
        ]];

        $factors = CraftModifiers::factors($payload, ['aluminum' => 783, 'hephaestanite' => 585, 'iron' => 874]);

        // The barrel alone drives damage and fire rate.
        $this->assertEqualsWithDelta(1.0561, $factors['weapon_damage'], 0.0001);
        $this->assertEqualsWithDelta(1.0898, $factors['weapon_firerate'], 0.0001);
        // DPS is the two together: +15.09% on a 195 DPS base.
        $this->assertEqualsWithDelta(224.4, 195 * $factors['weapon_damage'] * $factors['weapon_firerate'], 0.2);
        // Recoil multiplies both slots: ×0.8868 × ×0.966 = ×0.857.
        $this->assertEqualsWithDelta(0.8567, $factors['weapon_recoil_kick'], 0.0005);
    }

    /** A material with no known quality leaves its slot's stats alone. */
    public function test_unknown_material_quality_contributes_nothing(): void
    {
        $payload = ['v' => CraftModifiers::VERSION, 'groups' => [
            $this->group('Barrel', 'Iron', [$this->modifier('weapon_damage', 0.925, 1.075)]),
        ]];

        $this->assertSame([], CraftModifiers::factors($payload, []));
    }

    /** Segmented modifiers bend at their midpoint instead of running straight. */
    public function test_segmented_modifier_is_piecewise(): void
    {
        $modifier = [
            'property_key' => 'health_maxhealth',
            'label' => 'Integrity',
            'better_when' => 'higher',
            'quality_range' => ['min' => 0, 'max' => 500],
            'modifier_range' => ['at_min_quality' => 0.8, 'at_max_quality' => 1.0],
            'value_range_type' => 'linear',
            'value_segments' => [
                ['quality_min' => 0, 'quality_max' => 500, 'modifier_at_start' => 0.8, 'modifier_at_end' => 1.0],
                ['quality_min' => 501, 'quality_max' => 1000, 'modifier_at_start' => 1.0, 'modifier_at_end' => 1.2],
            ],
        ];

        $this->assertEqualsWithDelta(0.8, CraftModifiers::multiplier($modifier, 0), 0.0001);
        $this->assertEqualsWithDelta(0.9, CraftModifiers::multiplier($modifier, 250), 0.0001);
        $this->assertEqualsWithDelta(1.0, CraftModifiers::multiplier($modifier, 500), 0.0001);
        $this->assertEqualsWithDelta(1.1, CraftModifiers::multiplier($modifier, 750), 0.001);
        $this->assertEqualsWithDelta(1.2, CraftModifiers::multiplier($modifier, 1000), 0.0001);
    }

    /** Power pips step in whole numbers the wiki API does not spell out. */
    public function test_integer_additive_modifier_is_unknown(): void
    {
        $modifier = [
            'property_key' => 'itemresource_powergeneration',
            'label' => 'Power Pips',
            'better_when' => 'neutral',
            'quality_range' => ['min' => 0, 'max' => 249],
            'modifier_range' => ['at_min_quality' => null, 'at_max_quality' => null],
            'value_range_type' => 'linear_integer_additive',
            'value_segments' => [['quality_min' => 0, 'quality_max' => 249, 'modifier_at_start' => 1, 'modifier_at_end' => 1]],
        ];

        $this->assertNull(CraftModifiers::multiplier($modifier, 800));
    }

    /** The span crafting can reach: worst and best material in every slot. */
    public function test_extremes_multiply_across_slots(): void
    {
        $payload = ['v' => CraftModifiers::VERSION, 'groups' => [
            $this->group('Cycler', 'Riccite', [$this->modifier('weapon_damage', 0.95, 1.05)]),
            $this->group('Barrel', 'Titanium', [$this->modifier('weapon_damage', 0.95, 1.05)]),
        ]];

        [$worst, $best] = CraftModifiers::extremes($payload)['weapon_damage'];
        $this->assertEqualsWithDelta(0.9025, $worst, 0.0001);
        $this->assertEqualsWithDelta(1.1025, $best, 0.0001);
    }

    /** Only the detail route's groups are kept, pruned to what the UI needs. */
    public function test_payload_keeps_one_material_and_its_modifiers(): void
    {
        $payload = CraftModifiers::payload(['requirement_groups' => [[
            'key' => 'FRAME',
            'name' => 'Frame',
            'kind' => 'group',
            'required_count' => 1,
            'modifiers' => [$this->modifier('health_maxhealth', 0.9, 1.1) + ['property_uuid' => null]],
            'children' => [['kind' => 'resource', 'name' => 'Iron', 'min_quality' => 1, 'quantity_scu' => 1.16, 'modifiers' => []]],
        ]]]);

        $group = CraftModifiers::groups($payload)[0];
        $this->assertSame('Iron', $group['material']);
        $this->assertSame(1, $group['min_quality']);
        $this->assertSame('health_maxhealth', $group['modifiers'][0]['property_key']);
        $this->assertArrayNotHasKey('property_uuid', $group['modifiers'][0]);
    }
}
