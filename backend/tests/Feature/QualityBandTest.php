<?php

namespace Tests\Feature;

use App\Models\ResourceType;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Quality bands come out of the game's own DataCore, so the reference file wins
 * outright: the entry grids only offer known bands, and a band the game has but
 * the catalogue does not is a quality a player physically cannot record.
 */
class QualityBandTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_reference_replaces_what_was_there_rather_than_merging(): void
    {
        // 359 is what the wiki said Gold's lowest band was. It is Borase's.
        $gold = ResourceType::create([
            'name' => 'Gold', 'category' => 'refined', 'known_qualities' => [359, 553, 644, 786, 864, 916, 959, 1000],
        ]);

        $this->artisan('starbuddy:sync-quality-bands')->assertSuccessful();

        $bands = $gold->fresh()->known_qualities;
        $this->assertContains(264, $bands, 'the game says 264, and a Levski capture printed it');
        $this->assertNotContains(359, $bands, 'a wrong band has to leave, which a merge could never do');
    }

    public function test_an_ore_shares_the_ladder_of_the_metal_it_refines_into(): void
    {
        ResourceType::create(['name' => 'Gold', 'category' => 'refined']);
        ResourceType::create(['name' => 'Gold (Ore)', 'category' => 'ore']);

        $this->artisan('starbuddy:sync-quality-bands')->assertSuccessful();

        $ore = ResourceType::where('name', 'Gold (Ore)')->sole()->known_qualities;
        $this->assertSame([264, 553, 644, 786, 864, 916, 959, 1000], $ore);
    }

    public function test_crafting_materials_also_carry_the_dismantle_quality(): void
    {
        ResourceType::create(['name' => 'Gold', 'category' => 'refined']);
        ResourceType::create(['name' => 'Gold (Ore)', 'category' => 'ore']);
        ResourceType::create(['name' => 'Hadanite', 'category' => 'gem']);

        $this->artisan('starbuddy:sync-quality-bands')->assertSuccessful();

        // Dismantling looted spawned gear returns quality 500, so every material
        // gear is crafted from can be held at it.
        $this->assertContains(500, ResourceType::where('name', 'Gold')->sole()->known_qualities);
        $this->assertContains(500, ResourceType::where('name', 'Hadanite')->sole()->known_qualities);
        // An ore is never a dismantle return.
        $this->assertNotContains(500, ResourceType::where('name', 'Gold (Ore)')->sole()->known_qualities);
    }

    public function test_a_crafting_material_the_game_has_no_ladder_for_still_gets_it(): void
    {
        // Steel is crafted with and dismantled from, but has no quantization
        // record — nothing is mined as steel.
        $steel = ResourceType::create(['name' => 'Steel', 'category' => 'refined', 'known_qualities' => [712]]);

        $this->artisan('starbuddy:sync-quality-bands')->assertSuccessful();

        $this->assertSame([500, 712], $steel->fresh()->known_qualities);
    }

    public function test_the_variants_the_game_spells_differently_are_still_found(): void
    {
        ResourceType::create(['name' => 'Raw Silicon', 'category' => 'refined']);
        ResourceType::create(['name' => 'Ice', 'category' => 'ore']);

        $this->artisan('starbuddy:sync-quality-bands')->assertSuccessful();

        $this->assertSame(
            [310, 500, 510, 672, 782, 889, 926, 968, 1000],
            ResourceType::where('name', 'Raw Silicon')->sole()->known_qualities,
        );
        $this->assertSame(
            [322, 561, 659, 714, 873, 922, 966, 1000],
            ResourceType::where('name', 'Ice')->sole()->known_qualities,
        );
    }

    public function test_a_full_ladder_stops_entries_inventing_bands(): void
    {
        ResourceType::create(['name' => 'Gold (Ore)', 'category' => 'ore']);
        $this->artisan('starbuddy:sync-quality-bands')->assertSuccessful();

        $gold = ResourceType::where('name', 'Gold (Ore)')->sole();
        $gold->learnQuality(777);

        $this->assertNotContains(777, $gold->fresh()->known_qualities);
    }

    public function test_every_material_in_the_reference_has_a_full_ladder(): void
    {
        $reference = json_decode(file_get_contents(database_path('data/quality-bands.json')), true);

        $this->assertNotEmpty($reference['materials']);
        foreach ($reference['materials'] as $material) {
            $this->assertCount(8, $material['bands'], "{$material['name']} should have eight bands");
            $this->assertSame(1000, end($material['bands']), "{$material['name']} should top out at 1000");
            $sorted = $material['bands'];
            sort($sorted);
            $this->assertSame($sorted, $material['bands'], "{$material['name']} should be in order");
        }
    }
}
