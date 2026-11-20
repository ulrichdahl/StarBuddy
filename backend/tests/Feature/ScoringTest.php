<?php

namespace Tests\Feature;

use App\Models\Org;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Points for Game.log activity and the org leaderboard built on them: only
 * what the game wrote counts, places once a month, points per contributing
 * pilot, and points stay with the org they were earned for.
 */
class ScoringTest extends TestCase
{
    use RefreshDatabase;

    private User $me;
    private User $mate;
    private User $rival;
    private Org $mine;
    private Org $other;

    protected function setUp(): void
    {
        parent::setUp();
        CarbonImmutable::setTestNow('2956-11-20 12:00:00');
        \Illuminate\Support\Carbon::setTestNow('2956-11-20 12:00:00');

        $this->me = User::factory()->create(['discord_id' => '1', 'handle' => 'RavenMind']);
        $this->mate = User::factory()->create(['discord_id' => '2', 'handle' => 'Ash']);
        $this->rival = User::factory()->create(['discord_id' => '3', 'handle' => 'Zed']);
        User::factory()->create(['discord_id' => '4', 'handle' => 'Idle']); // in no org

        $this->mine = Org::create(['name' => 'Syndikatet', 'sid' => 'SYN']);
        $this->mine->memberships()->attach($this->me->id, ['role' => 'manager', 'status' => 'active']);
        $this->mine->memberships()->attach($this->mate->id, ['role' => 'member', 'status' => 'active']);
        $this->other = Org::create(['name' => 'Nordlys']);
        $this->other->memberships()->attach($this->rival->id, ['role' => 'member', 'status' => 'active']);
    }

    private function ingest(User $user, array $events, ?array $character = null)
    {
        $body = ['events' => array_map(fn ($e) => [
            'kind' => $e[0], 'timestamp' => $e[1], 'detail' => $e[2], 'raw' => "<{$e[1]}> raw {$e[2]}",
        ], $events)];
        if ($character) {
            $body['character'] = $character;
        }

        return $this->actingAs($user)->postJson('/api/ingest/events', $body)->assertOk();
    }

    public function test_missions_refinery_and_new_places_score_flat_points(): void
    {
        $res = $this->ingest($this->me, [
            ['mission_completed', '2956-11-10T10:00:00Z', 'Small Purchase Order: Hand Mined Materials'],
            ['mission_completed', '2956-11-10T11:00:00Z', 'Small Purchase Order: Hand Mined Materials'], // repeats count
            ['refinery_completed', '2956-11-10T12:00:00Z', 'CRU-L1 Ambitious Dream Station'],
            ['quantum_arrived', '2956-11-10T13:00:00Z', 'levski_all-001'],          // Nyx 5
            ['location', '2956-11-10T13:05:00Z', 'Stanton3_Area18'],                // Stanton 3
            ['location', '2956-11-11T09:00:00Z', 'Stanton3_Area18'],                // again this month: 0
            ['quantum_arrived', '2956-11-12T09:00:00Z', 'rs_ext_nyx-pyro_jp1'],     // Pyro wins 8
            ['quantum_arrived', '2956-11-12T10:00:00Z', 'MISSION_QT_Beacon_926062414358'], // one-off: 0
            ['jurisdiction', '2956-11-12T11:00:00Z', 'ArcCorp'],                     // 2
            ['vehicle_released', '2956-11-12T12:00:00Z', '939134497401'],           // stored only
            ['blueprint', '2956-11-12T12:30:00Z', 'Karna Rifle'],                    // never scores
        ])->json();

        $this->assertSame(2 * 10 + 5 + 5 + 3 + 8 + 2, $res['points']);
        $this->assertSame(1, $res['refinery_completed']);
        $this->assertSame(11, $res['accepted']);

        $row = DB::table('score_events')->where('detail', 'levski_all-001')->first();
        $this->assertSame('nyx', $row->system);
        $this->assertSame('<2956-11-10T13:00:00Z> raw levski_all-001', $row->raw);
        $this->assertSame($this->mine->id, $row->org_id);

        // Next month the place scores again.
        $this->ingest($this->me, [['location', '2956-12-01T09:00:00Z', 'Stanton3_Area18']]);
        $this->assertSame(2, DB::table('score_events')->where('place', 'place:stanton3_area18')->count());
    }

    public function test_the_org_score_is_points_per_contributing_pilot(): void
    {
        // We: 30 + 10 = 40 over two pilots = 20. Rival: 30 alone = 30.
        $this->ingest($this->me, [
            ['mission_completed', '2956-11-10T10:00:00Z', 'A'],
            ['mission_completed', '2956-11-10T11:00:00Z', 'B'],
            ['mission_completed', '2956-11-10T12:00:00Z', 'C'],
        ]);
        $this->ingest($this->mate, [['mission_completed', '2956-11-11T10:00:00Z', 'A']]);
        $this->ingest($this->rival, [
            ['mission_completed', '2956-11-11T10:00:00Z', 'A'],
            ['refinery_completed', '2956-11-11T11:00:00Z', 'ARC-L1'],
            ['refinery_completed', '2956-11-11T12:00:00Z', 'ARC-L1 '],
            ['refinery_completed', '2956-11-11T13:00:00Z', 'ARC-L2'],
            ['refinery_completed', '2956-11-11T14:00:00Z', 'ARC-L3'],
        ]);
        // Last month's mission only shows all time.
        $this->ingest($this->me, [['mission_completed', '2956-10-30T10:00:00Z', 'Old']]);

        $res = $this->actingAs($this->me)->getJson('/api/dashboard/competition?period=month')->assertOk()->json();
        $us = collect($res['orgs'])->firstWhere('id', $this->mine->id);
        $them = collect($res['orgs'])->firstWhere('id', $this->other->id);

        $this->assertSame(2, $us['contributors']);
        $this->assertSame(2, $us['member_count']);
        $this->assertSame(40, $us['points']);
        $this->assertSame(20, $us['score']);
        $this->assertSame(30, $them['score']);
        $this->assertSame(['overall' => 2, 'mission' => 1, 'refinery' => 2, 'travel' => 1], $us['rank']);
        $this->assertSame(['mission' => ['mine' => 30, 'org' => 40], 'refinery' => ['mine' => 0, 'org' => 0], 'travel' => ['mine' => 0, 'org' => 0]], $res['contribution']);

        $all = $this->actingAs($this->me)->getJson('/api/dashboard/competition?period=all')->json();
        $this->assertSame(25, collect($all['orgs'])->firstWhere('id', $this->mine->id)['score']);

        $this->actingAs($this->me)->getJson('/api/dashboard/competition?period=year')->assertUnprocessable();
    }

    public function test_points_stay_with_the_org_they_were_earned_for(): void
    {
        $this->ingest($this->mate, [['mission_completed', '2956-11-10T10:00:00Z', 'A']]);
        $this->mine->memberships()->detach($this->mate->id);
        $this->other->memberships()->attach($this->mate->id, ['role' => 'member', 'status' => 'active']);
        $this->ingest($this->mate, [['mission_completed', '2956-11-11T10:00:00Z', 'B']]);

        $this->artisan('score:recount')->assertSuccessful();

        $this->assertSame(10, (int) DB::table('score_events')->where('org_id', $this->mine->id)->sum('points'));
        $this->assertSame(10, (int) DB::table('score_events')->where('org_id', $this->other->id)->sum('points'));
    }

    public function test_only_the_players_own_characters_score(): void
    {
        // Another account's character scores nothing.
        $this->ingest($this->me, [['mission_completed', '2956-11-09T10:00:00Z', 'A']], ['name' => 'Chubber', 'geid' => '1', 'account_id' => '2392092']);
        // An old name on the player's own account counts once the account is
        // known, even though it arrived first.
        $this->ingest($this->me, [['mission_completed', '2956-11-09T11:00:00Z', 'B']], ['name' => 'DK-Raven', 'geid' => '2', 'account_id' => '1953448']);
        $this->assertSame(0, DB::table('score_events')->count());

        $this->ingest($this->me, [['mission_completed', '2956-11-10T10:00:00Z', 'C']], ['name' => 'RavenMind', 'geid' => '3', 'account_id' => '1953448']);

        $this->assertEqualsCanonicalizing(['B', 'C'], DB::table('score_events')->pluck('detail')->all());
        $this->assertSame('DK-Raven', DB::table('score_events')->where('detail', 'B')->value('character_name'));
    }

    public function test_the_members_board_is_the_callers_own_org(): void
    {
        $this->ingest($this->mate, [['mission_completed', '2956-11-10T10:00:00Z', 'A'], ['jurisdiction', '2956-11-10T11:00:00Z', 'Hurston']]);
        $this->ingest($this->rival, [['mission_completed', '2956-11-10T10:00:00Z', 'A']]);

        $res = $this->actingAs($this->me)->getJson('/api/dashboard/members')->assertOk()->json();
        $this->assertSame($this->mine->id, $res['org_id']);
        $this->assertSame(['Ash', 'RavenMind'], array_column($res['members'], 'handle'));
        $this->assertSame([12, 0], array_column($res['members'], 'points'));
        $this->assertSame([1, 2], array_column($res['members'], 'rank'));
        $this->assertSame(['points' => 2, 'events' => 1], $res['members'][0]['kinds']['travel']);
    }
}
