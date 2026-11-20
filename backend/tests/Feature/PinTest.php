<?php

namespace Tests\Feature;

use App\Models\Blueprint;
use App\Models\BlueprintOwned;
use App\Models\BlueprintPool;
use App\Models\BlueprintPoolEntry;
use App\Models\Location;
use App\Models\Org;
use App\Models\ResourceStack;
use App\Models\ResourceType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Pinning a blueprint to craft sums its materials into a gathering list;
 * tracking a reward pool follows what is left of it.
 */
class PinTest extends TestCase
{
    use RefreshDatabase;

    private User $me;
    private User $mate;
    private Blueprint $battery;
    private Blueprint $rifle;
    private BlueprintPool $pool;

    protected function setUp(): void
    {
        parent::setUp();
        $this->me = User::factory()->create(['discord_id' => '1', 'handle' => 'Raven']);
        $this->mate = User::factory()->create(['discord_id' => '2', 'handle' => 'Froggy']);
        $org = Org::create(['name' => 'Syndikatet']);
        $org->memberships()->attach($this->me->id, ['role' => 'member', 'status' => 'active']);
        $org->memberships()->attach($this->mate->id, ['role' => 'member', 'status' => 'active']);

        $this->battery = Blueprint::create([
            'uuid' => (string) Str::uuid(), 'key' => 'BP_battery', 'name' => 'Karna Battery',
            'ingredients' => [['name' => 'Copper', 'quantity_mscu' => 300], ['name' => 'Tin', 'quantity_mscu' => 100]],
        ]);
        $this->rifle = Blueprint::create([
            'uuid' => (string) Str::uuid(), 'key' => 'BP_rifle', 'name' => 'Karna Rifle',
            'ingredients' => [['name' => 'Copper', 'quantity_mscu' => 1000]],
        ]);

        $copper = ResourceType::create(['name' => 'Copper', 'category' => 'metal', 'unit' => 'mscu']);
        $hangar = Location::create(['name' => 'Area18', 'kind' => 'landing_zone', 'system' => 'Stanton']);
        $stack = fn (User $u, int $q, string $vis) => ResourceStack::create([
            'user_id' => $u->id, 'location_id' => $hangar->id, 'resource_type_id' => $copper->id,
            'quality' => 500, 'quantity' => $q, 'visibility' => $vis, 'source' => 'manual',
        ]);
        $stack($this->me, 400, 'private');
        $stack($this->mate, 2000, 'org');

        $this->pool = BlueprintPool::create([
            'key' => 'bp_missionreward_cfp_chain', 'record' => 'BlueprintPoolRecord.BP_MISSIONREWARD_CFP_Chain',
            'sources' => [['kind' => 'contract', 'contractor' => 'Citizens for Prosperity', 'chance' => 1, 'missions' => [['title' => 'Reclaim Outpost', 'unreleased' => false]]]],
        ]);
        foreach ([$this->battery, $this->rifle] as $bp) {
            BlueprintPoolEntry::create([
                'blueprint_pool_id' => $this->pool->id, 'blueprint_id' => $bp->id,
                'blueprint_key' => strtolower($bp->key), 'weight' => 1,
            ]);
        }
        BlueprintOwned::create(['user_id' => $this->mate->id, 'blueprint_id' => $this->rifle->id, 'blueprint_name' => 'Karna Rifle', 'source' => 'log']);

        $this->actingAs($this->me);
    }

    public function test_craft_targets_sum_materials_against_my_stock_and_the_orgs(): void
    {
        $this->postJson('/api/craft-targets', ['blueprint_id' => $this->battery->id, 'quantity' => 2])->assertCreated();
        $this->postJson('/api/craft-targets', ['blueprint_id' => $this->rifle->id])->assertCreated();
        $this->postJson('/api/craft-targets', ['blueprint_id' => $this->battery->id, 'quantity' => 3])->assertOk();

        $res = $this->getJson('/api/craft-targets')->assertOk()->json();

        $this->assertSame([3, 1], array_column($res['targets'], 'quantity'));
        $copper = collect($res['gathering'])->firstWhere('name', 'Copper');
        $this->assertSame(3 * 300 + 1000, $copper['need']);
        $this->assertSame(400, $copper['have_mine']);
        $this->assertSame(2400, $copper['have_org'], 'my own private stack plus the mate\'s org stack');
        $this->assertSame(1500, $copper['missing']);
        $this->assertEqualsCanonicalizing([$this->battery->id, $this->rifle->id], $copper['for']);
        $this->assertSame(300, collect($res['gathering'])->firstWhere('name', 'Tin')['missing']);

        $this->assertSame(['quantity' => 3], $this->getJson("/api/blueprints/{$this->battery->id}")->json('craft_target'));

        $this->deleteJson("/api/craft-targets/{$this->battery->id}")->assertNoContent();
        $this->assertCount(1, $this->getJson('/api/craft-targets')->json('targets'));
        $this->assertNull($this->getJson("/api/blueprints/{$this->battery->id}")->json('craft_target'));
    }

    public function test_only_stock_at_the_recipes_quality_counts(): void
    {
        $this->battery->update(['requirement_groups' => ['v' => 1, 'groups' => [
            ['key' => 'FRAME', 'name' => 'Frame', 'material' => 'Copper', 'kind' => 'resource', 'min_quality' => 600, 'modifiers' => []],
        ]]]);
        $this->postJson('/api/craft-targets', ['blueprint_id' => $this->battery->id, 'quantity' => 2])->assertCreated();

        $res = $this->getJson('/api/craft-targets')->assertOk()->json();
        $copper = collect($res['gathering'])->firstWhere('name', 'Copper');

        $this->assertSame(600, $copper['min_quality']);
        $this->assertSame(0, $copper['have_mine'], 'my 400 are quality 500');
        $this->assertSame(400, $copper['have_mine_below']);
        $this->assertSame(600, $copper['missing']);
        $this->assertSame([['blueprint_id' => $this->battery->id, 'name' => 'Karna Battery', 'quantity' => 2]], $copper['for_targets']);
        $this->assertFalse($res['targets'][0]['ready']);
        $this->assertSame(2, $res['targets'][0]['materials']);
        $this->assertSame(['materials' => 2, 'still_to_gather' => 2, 'still_to_gather_with_org' => 2], $res['summary']);
    }

    public function test_the_shopping_list_posts_to_discord_only_when_a_channel_is_set(): void
    {
        \Illuminate\Support\Facades\Queue::fake();
        $this->postJson('/api/craft-targets', ['blueprint_id' => $this->rifle->id])->assertCreated();

        config(['starbuddy.gathering_channel_id' => null]);
        $this->assertFalse($this->getJson('/api/craft-targets')->json('discord.can_post'));
        $this->postJson('/api/craft-targets/share')->assertStatus(409);

        config(['starbuddy.gathering_channel_id' => '123']);
        $this->assertTrue($this->getJson('/api/craft-targets')->json('discord.can_post'));
        $this->postJson('/api/craft-targets/share', ['scope' => 'mine'])->assertStatus(202)->assertJsonPath('posted', 1);
        \Illuminate\Support\Facades\Queue::assertPushed(\App\Jobs\NotifyDiscord::class, fn ($job) => $job->channelId === '123'
            && str_contains($job->embed['description'], 'Copper'));

        // Counting the org's 2000, the rifle's copper is covered.
        $this->postJson('/api/craft-targets/share', ['scope' => 'org'])->assertUnprocessable();
    }

    public function test_targets_are_per_player(): void
    {
        $this->postJson('/api/craft-targets', ['blueprint_id' => $this->battery->id])->assertCreated();
        $this->actingAs($this->mate)->getJson('/api/craft-targets')->assertOk()->assertJsonCount(0, 'targets');
    }

    public function test_tracked_pools_report_what_is_missing(): void
    {
        $this->postJson('/api/tracked-pools', ['pool_key' => $this->pool->key])->assertCreated();
        $this->postJson('/api/tracked-pools', ['pool_key' => $this->pool->key])->assertOk();
        $this->postJson('/api/tracked-pools', ['pool_key' => 'no_such_pool'])->assertUnprocessable();

        $res = $this->getJson('/api/tracked-pools')->assertOk()->json();
        $this->assertCount(1, $res);
        $this->assertSame(2, $res[0]['in_pool']);
        $this->assertSame(0, $res[0]['owned_in_pool']);
        $this->assertSame(['Citizens for Prosperity'], $res[0]['factions']);
        $this->assertSame('Reclaim Outpost', $res[0]['sources'][0]['missions'][0]['title']);

        $pool = $this->getJson("/api/blueprints/{$this->battery->id}")->json('missions.0');
        $this->assertTrue($pool['tracked']);
        $this->assertSame(1, $pool['owned_in_pool_org'], 'the mate holds the rifle');
        $rifle = collect($pool['contents'])->firstWhere('blueprint_id', $this->rifle->id);
        $this->assertSame([['id' => $this->mate->id, 'handle' => 'Froggy']], $rifle['holders']);

        $this->deleteJson('/api/tracked-pools/'.$this->pool->key)->assertNoContent();
        $this->assertCount(0, $this->getJson('/api/tracked-pools')->json());
    }
}
