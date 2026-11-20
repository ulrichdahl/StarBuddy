<?php

namespace Tests\Feature;

use App\Models\Org;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/** Game presence from the desktop client, shown to main-org mates only. */
class PresenceTest extends TestCase
{
    use RefreshDatabase;

    public function test_presence_reaches_main_org_mates_only_and_goes_stale(): void
    {
        $me = User::factory()->create(['discord_id' => '1', 'handle' => 'Raven']);
        $mate = User::factory()->create(['discord_id' => '2', 'handle' => 'Froggy']);
        $other = User::factory()->create(['discord_id' => '3', 'handle' => 'Zed']);
        $main = Org::create(['name' => 'Syndikatet']);
        $side = Org::create(['name' => 'Nordlys']);
        $main->memberships()->attach($me->id, ['role' => 'member', 'status' => 'active']);
        $main->memberships()->attach($mate->id, ['role' => 'member', 'status' => 'active']);
        $side->memberships()->attach($me->id, ['role' => 'member', 'status' => 'active']);
        $side->memberships()->attach($other->id, ['role' => 'member', 'status' => 'active']);
        $me->forceFill(['main_org_id' => $main->id])->save();

        $report = ['running' => true, 'environment' => 'PUB', 'branch' => 'sc-alpha-4.10.0', 'shard' => 'pub_euw1b_13165946_320',
            'location_code' => 'RR_ARC_LEO', 'location' => 'Baijini Point', 'ship' => 'RSI Galaxy',
            'character' => ['geid' => '1', 'name' => 'Froggy', 'account_id' => '9']];
        $this->actingAs($mate)->postJson('/api/presence', $report)->assertNoContent();
        $this->actingAs($other)->postJson('/api/presence', $report)->assertNoContent();

        $mates = collect($this->actingAs($me->fresh())->getJson('/api/org/mates')->assertOk()->json())->keyBy('handle');
        $this->assertTrue($mates['Froggy']['presence']['running']);
        $this->assertSame('pub_euw1b_13165946_320', $mates['Froggy']['presence']['shard']);
        $this->assertSame('Baijini Point', $mates['Froggy']['presence']['location']);
        $this->assertNull($mates['Zed']['presence'], 'only the main org sees presence');

        Carbon::setTestNow(now()->addMinutes(6));
        $this->assertFalse($this->getJson('/api/org/mates')->json('0.presence.running'), 'a stale report is not running');
        Carbon::setTestNow();

        // Sharing off removes it.
        $this->actingAs($mate)->postJson('/api/presence', ['share' => false, 'running' => true])->assertNoContent();
        $this->assertNull(collect($this->actingAs($me->fresh())->getJson('/api/org/mates')->json())->firstWhere('handle', 'Froggy')['presence']);
    }
}
