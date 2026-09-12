<?php

namespace Tests\Feature;

use App\Models\Blueprint;
use App\Models\BlueprintOwned;
use App\Models\BlueprintPool;
use App\Models\BlueprintPoolEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * A blueprint is not bought: finishing a mission draws one recipe from the
 * pool that mission's contract names. The dialog has to answer both halves —
 * which missions feed a pool holding this recipe, and how thin that pool is.
 */
class BlueprintPoolTest extends TestCase
{
    use RefreshDatabase;

    private User $me;

    protected function setUp(): void
    {
        parent::setUp();
        $this->me = User::factory()->create(['discord_id' => '1', 'handle' => 'DK-Raven']);
    }

    private function blueprint(string $key, string $name): Blueprint
    {
        return Blueprint::create(['uuid' => (string) Str::uuid(), 'key' => $key, 'name' => $name]);
    }

    public function test_a_blueprint_lists_the_pools_that_award_it_tightest_first(): void
    {
        $shotgun = $this->blueprint('BP_CRAFT_gmni_shotgun_ballistic_01', 'R97 Shotgun');
        $filler = $this->blueprint('BP_CRAFT_filler', 'Something Else');

        $boss = BlueprintPool::create([
            'key' => 'bp_missionreward_rdc_boss',
            'record' => 'BlueprintPoolRecord.BP_MISSIONREWARD_RDC_Boss',
            'sources' => [[
                'kind' => 'contract', 'contractor' => 'Vaughn', 'chance' => 1.0,
                'missions' => ['End of a Salamander'],
            ]],
        ]);
        // Two blueprints in, so one draw in two.
        foreach ([$shotgun, $filler] as $bp) {
            BlueprintPoolEntry::create([
                'blueprint_pool_id' => $boss->id, 'blueprint_id' => $bp->id,
                'blueprint_key' => strtolower($bp->key), 'weight' => 1,
            ]);
        }

        $solo = BlueprintPool::create([
            'key' => 'bp_reward_shotgun',
            'sources' => [['kind' => 'event', 'event' => 'ORS', 'min_points' => 43200]],
        ]);
        BlueprintPoolEntry::create([
            'blueprint_pool_id' => $solo->id, 'blueprint_id' => $shotgun->id,
            'blueprint_key' => strtolower($shotgun->key), 'weight' => 1,
        ]);

        $response = $this->actingAs($this->me)
            ->getJson("/api/blueprints/{$shotgun->id}")
            ->assertOk();

        // The pool of one is the better chance, so it leads.
        $response->assertJsonPath('missions.0.pool_key', 'bp_reward_shotgun')
            ->assertJsonPath('missions.0.in_pool', 1)
            ->assertJsonPath('missions.0.draw_percent', 100)
            ->assertJsonPath('missions.0.sources.0.event', 'ORS')
            ->assertJsonPath('missions.1.pool_key', 'bp_missionreward_rdc_boss')
            ->assertJsonPath('missions.1.draw_percent', 50)
            ->assertJsonPath('missions.1.sources.0.contractor', 'Vaughn')
            ->assertJsonPath('missions.1.sources.0.missions.0', 'End of a Salamander');

        // The pool's contents, the one being read first and the rest after.
        $response->assertJsonPath('missions.1.contents.0.name', 'R97 Shotgun')
            ->assertJsonPath('missions.1.contents.0.is_this_one', true)
            ->assertJsonPath('missions.1.contents.1.name', 'Something Else')
            ->assertJsonPath('missions.1.contents.1.owned', false);
    }

    public function test_a_pool_says_how_much_of_it_the_player_already_holds(): void
    {
        $mine = $this->blueprint('BP_CRAFT_mine', 'Already Mine');
        $wanted = $this->blueprint('BP_CRAFT_wanted', 'Still Wanted');
        $default = $this->blueprint('BP_CRAFT_default', 'Everyone Has This');
        $default->update(['is_default' => true]);

        BlueprintOwned::create([
            'user_id' => $this->me->id, 'blueprint_id' => $mine->id,
            'blueprint_name' => $mine->name, 'source' => 'manual',
        ]);

        $pool = BlueprintPool::create(['key' => 'bp_missionreward_mixed', 'sources' => []]);
        foreach ([$mine, $wanted, $default] as $bp) {
            BlueprintPoolEntry::create([
                'blueprint_pool_id' => $pool->id, 'blueprint_id' => $bp->id,
                'blueprint_key' => strtolower($bp->key), 'weight' => 1,
            ]);
        }

        // Two of three: the one marked owned, and the one nobody has to earn.
        $this->actingAs($this->me)
            ->getJson("/api/blueprints/{$wanted->id}")
            ->assertOk()
            ->assertJsonPath('missions.0.owned_in_pool', 2)
            ->assertJsonPath('missions.0.owned_percent', 67)
            // The recipe being read leads, then what is still missing, then
            // what the player already holds.
            ->assertJsonPath('missions.0.contents.0.name', 'Still Wanted')
            ->assertJsonPath('missions.0.contents.1.owned', true);
    }

    public function test_a_blueprint_no_mission_awards_lists_nothing(): void
    {
        $orphan = $this->blueprint('BP_CRAFT_orphan', 'Nobody Gives This');

        $this->actingAs($this->me)
            ->getJson("/api/blueprints/{$orphan->id}")
            ->assertOk()
            ->assertJsonCount(0, 'missions');
    }

    public function test_the_pool_label_keeps_the_casing_the_record_has(): void
    {
        $pool = BlueprintPool::make([
            'key' => 'bp_missionreward_headhunters_mercenaryfps_eliminateall_regionab',
            'record' => 'BlueprintPoolRecord.BP_MISSIONREWARD_HeadHunters_MercenaryFPS_EliminateALL_RegionAB',
        ]);

        // The key is lowercased in the game files; the record is not, and that
        // is the only thing standing between a label and one long word.
        $this->assertSame('Head Hunters Mercenary FPS Eliminate ALL Region AB', $pool->label());
    }

    public function test_the_reference_file_matches_the_recipe_catalogue(): void
    {
        $data = json_decode((string) file_get_contents(database_path('data/blueprint-pools.json')), true);
        $this->assertNotEmpty($data['pools'] ?? [], 'the shipped pool reference is readable');

        // Every pool entry names a blueprint by key, and the sync matches on
        // it case-insensitively — so a key that stops looking like one is the
        // bug this catches.
        foreach ($data['pools'] as $pool) {
            $this->assertNotSame('', $pool['key']);
            foreach ($pool['blueprints'] as $entry) {
                $this->assertMatchesRegularExpression('/^bp_/i', $entry['key'], "{$pool['key']} names a blueprint oddly");
            }
        }
    }
}
