<?php

namespace Tests\Feature;

use App\Models\Blueprint;
use App\Models\BlueprintOwned;
use App\Models\User;
use App\Support\CraftModifiers;
use App\Support\FabricatorCategory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class BlueprintCatalogTest extends TestCase
{
    use RefreshDatabase;

    private function bp(string $name, string $type, ?string $sub = null, string $grade = '1'): Blueprint
    {
        return Blueprint::create(['name' => $name, 'type' => $type, 'sub_type' => $sub, 'grade' => $grade]);
    }

    public function test_kiosk_categories_and_order(): void
    {
        $this->assertSame(['weapons', 'sidearms'], FabricatorCategory::of($this->bp('Arclight', 'WeaponPersonal', 'Small')));
        $this->assertSame(['weapons', 'primary'], FabricatorCategory::of($this->bp('P4-AR Rifle', 'WeaponPersonal', 'Medium')));
        $this->assertSame(['armor', 'core'], FabricatorCategory::of($this->bp('Testudo Core', 'Char_Armor_Torso', 'Heavy')));
        $this->assertSame(['ammo', 'ammo'], FabricatorCategory::of($this->bp('Pulse Laser Pistol Battery (60 Cap)', 'WeaponAttachment', 'Magazine')));
        $this->assertSame(['other', 'other'], FabricatorCategory::of($this->bp('Marlin', 'DockingCollar', 'Fuel')));
        $this->assertSame(['vehicles', 'mining'], FabricatorCategory::of($this->bp('Clearcut Module', 'WeaponMining', 'Gun')));
        $this->assertSame('Armor · Helmets', FabricatorCategory::label('armor', 'helmets'));
        $this->assertSame('Ammo', FabricatorCategory::label('ammo', 'ammo'));
        $this->assertTrue(FabricatorCategory::order('ammo', 'ammo') < FabricatorCategory::order('armor', 'arms'));
        $this->assertTrue(FabricatorCategory::order('armor', 'undersuits') < FabricatorCategory::order('other', 'other'));
        $this->assertTrue(FabricatorCategory::order('vehicles', 'weapons') < FabricatorCategory::order('weapons', 'sidearms'));
        $this->assertTrue(FabricatorCategory::order('weapons', 'sidearms') < FabricatorCategory::order('weapons', 'primary'));
    }

    public function test_catalog_lists_in_kiosk_order_with_ownership_and_filters(): void
    {
        $me = User::factory()->create(['discord_id' => '1', 'handle' => 'DK-Raven']);
        Sanctum::actingAs($me);
        $rifle = $this->bp('P4-AR Rifle', 'WeaponPersonal', 'Medium');
        $helmet = $this->bp('Corbel Helmet Smolder', 'Char_Armor_Helmet', 'Heavy');
        $ammo = $this->bp('Parallax Rifle Battery (80 Cap)', 'WeaponAttachment', 'Magazine', '2');
        $cooler = Blueprint::create(['name' => 'MIL-3B "Tempest"', 'type' => 'Cooler', 'grade' => '1', 'item_meta' => ['size' => 2]]);
        BlueprintOwned::create(['user_id' => $me->id, 'blueprint_id' => $helmet->id, 'blueprint_name' => $helmet->name, 'source' => 'manual']);

        $res = $this->getJson('/api/blueprints/catalog')->assertOk()->json();
        $this->assertSame([$ammo->id, $helmet->id, $cooler->id, $rifle->id], array_column($res['data'], 'id'), 'Ammo, Armor, Vehicles, Weapons — kiosk order');
        $this->assertSame(2, $res['data'][2]['size'], 'vehicle components carry their size');
        $this->assertNull($res['data'][1]['size'], 'armour has no size');
        $this->assertSame('Armor · Helmets', $res['data'][1]['category_label']);
        $this->assertSame('Armor · Helmet · Heavy', $res['data'][1]['type_display'], 'armour shows its weight class');
        $this->assertTrue($res['data'][1]['owned_by_me']);
        $this->assertSame(0, $res['data'][1]['owner_count']);
        $this->assertSame('ammo', $res['categories'][0]['key']);
        $this->assertSame(4, $res['total']);

        $this->assertSame([$rifle->id], array_column($this->getJson('/api/blueprints/catalog?category=weapons')->json('data'), 'id'));
        $this->assertSame([$helmet->id], array_column($this->getJson('/api/blueprints/catalog?category=armor/helmets')->json('data'), 'id'));
        $this->assertSame([$ammo->id, $cooler->id, $rifle->id], array_column($this->getJson('/api/blueprints/catalog?unowned_by_me=1')->json('data'), 'id'));
        $this->assertSame([$helmet->id], array_column($this->getJson('/api/blueprints/catalog?owned=1')->json('data'), 'id'), 'owned by anyone in the org');
        $this->assertSame([$ammo->id], array_column($this->getJson('/api/blueprints/catalog?grade=2')->json('data'), 'id'));
        // Name descending: "Parallax…" > "P4-AR…" > "Corbel…".
        $this->assertSame([$ammo->id, $rifle->id, $cooler->id, $helmet->id], array_column($this->getJson('/api/blueprints/catalog?sort=name&dir=desc')->json('data'), 'id'));

        $paged = $this->getJson('/api/blueprints/catalog?per_page=10&page=1')->assertOk()->json();
        $this->assertSame(10, $paged['per_page']);
        $this->assertSame(1, $paged['last_page']);
    }

    public function test_show_describes_a_blueprint(): void
    {
        $me = User::factory()->create(['discord_id' => '1', 'handle' => 'DK-Raven']);
        Sanctum::actingAs($me);
        $helmet = $this->bp('Corbel Helmet Smolder', 'Char_Armor_Helmet', 'Heavy');
        BlueprintOwned::create(['user_id' => $me->id, 'blueprint_id' => $helmet->id, 'blueprint_name' => $helmet->name, 'source' => 'manual']);

        $res = $this->getJson("/api/blueprints/{$helmet->id}")->assertOk()->json();
        $this->assertSame('Corbel Helmet Smolder', $res['blueprint']['name']);
        $this->assertSame('Armor · Helmets', $res['category_label']);
        $this->assertTrue($res['owned_by_me']);
        $this->assertSame([['id' => $me->id, 'handle' => 'DK-Raven', 'mine' => true]], $res['owners']);
        // No recipe slots cached, so there is nothing crafting could move.
        $this->assertSame([], $res['stat_ranges']);
        $this->assertSame([], $res['missions']);
    }

    /**
     * `stat_ranges` is what crafting can do to each property, worst material to
     * best, in percent off the default value.
     *
     * The arithmetic itself is pinned by CraftModifiersTest; what this covers is
     * the endpoint's contract, and in particular that a property two slots both
     * touch compounds instead of being averaged or overwritten — the bug the
     * per-slot model was introduced to fix.
     */
    public function test_show_reports_what_crafting_can_do_to_each_stat(): void
    {
        $me = User::factory()->create(['discord_id' => '1', 'handle' => 'DK-Raven']);
        Sanctum::actingAs($me);

        // Frame and stock both scale recoil kick x0.8…x1.2; the barrel scales
        // damage x0.925…x1.075 on its own. Power pips step in whole numbers
        // ('linear_integer_additive'), which carries no percentage at all.
        $recoil = [[
            'property_key' => 'weapon_recoil_kick',
            'label' => 'Recoil Kick',
            'better_when' => 'lower',
            'quality_range' => ['min' => 0, 'max' => 1000],
            'modifier_range' => ['at_min_quality' => 1.2, 'at_max_quality' => 0.8],
            'value_range_type' => 'linear',
            'value_segments' => null,
        ]];
        $rifle = $this->bp('CQ7 Rifle', 'WeaponPersonal', 'Medium');
        $rifle->update(['requirement_groups' => ['v' => CraftModifiers::VERSION, 'groups' => [
            ['key' => 'FRAME', 'name' => 'Frame', 'material' => 'Aluminum', 'kind' => 'resource', 'min_quality' => 0, 'modifiers' => $recoil],
            ['key' => 'STOCK', 'name' => 'Stock', 'material' => 'Hephaestanite', 'kind' => 'resource', 'min_quality' => 0, 'modifiers' => $recoil],
            ['key' => 'BARREL', 'name' => 'Barrel', 'material' => 'Iron', 'kind' => 'resource', 'min_quality' => 0, 'modifiers' => [
                [
                    'property_key' => 'weapon_damage',
                    'label' => 'Damage',
                    'better_when' => 'higher',
                    'quality_range' => ['min' => 0, 'max' => 1000],
                    'modifier_range' => ['at_min_quality' => 0.925, 'at_max_quality' => 1.075],
                    'value_range_type' => 'linear',
                    'value_segments' => null,
                ],
                [
                    'property_key' => 'weapon_power_pips',
                    'label' => 'Power Pips',
                    'better_when' => 'higher',
                    'quality_range' => ['min' => 0, 'max' => 1000],
                    'modifier_range' => ['at_min_quality' => 0, 'at_max_quality' => 2],
                    'value_range_type' => 'linear_integer_additive',
                    'value_segments' => null,
                ],
            ]],
        ]]]);

        $ranges = $this->getJson("/api/blueprints/{$rifle->id}")->assertOk()->json('stat_ranges');

        // Two slots at x0.8 and at x1.2 compound to x0.64 and x1.44. Whole
        // percentages arrive as ints, not floats: json_encode drops the zero
        // fraction, so -36.0 goes over the wire as -36.
        $this->assertSame(['min_percent' => -36, 'max_percent' => 44], $ranges['weapon_recoil_kick']);
        $this->assertSame(['min_percent' => -7.5, 'max_percent' => 7.5], $ranges['weapon_damage']);
        $this->assertArrayNotHasKey('weapon_power_pips', $ranges, 'whole-number steps carry no percentage');
    }

    public function test_toggle_and_bulk_own(): void
    {
        $me = User::factory()->create(['discord_id' => '1']);
        Sanctum::actingAs($me);
        $a = $this->bp('A', 'Cooler');
        $b = $this->bp('B', 'Shield');

        $this->postJson('/api/blueprints-owned/toggle', ['blueprint_id' => $a->id])->assertOk()->assertJson(['owned' => true]);
        $this->assertSame(1, BlueprintOwned::where('user_id', $me->id)->count());
        // Owning is boolean: toggling again removes it, never a second copy.
        $this->postJson('/api/blueprints-owned/toggle', ['blueprint_id' => $a->id])->assertOk()->assertJson(['owned' => false]);
        $this->assertSame(0, BlueprintOwned::count());

        $this->postJson('/api/blueprints-owned/bulk', ['blueprint_ids' => [$a->id, $b->id]])->assertOk()->assertJson(['added' => 2, 'already' => 0]);
        $this->postJson('/api/blueprints-owned/bulk', ['blueprint_ids' => [$a->id, $b->id]])->assertOk()->assertJson(['added' => 0, 'already' => 2]);
        $this->assertSame(2, BlueprintOwned::where('user_id', $me->id)->count());
    }
}
