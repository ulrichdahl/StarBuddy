<?php

namespace Tests\Feature;

use App\Models\BlueprintOwned;
use App\Models\Location;
use App\Models\Org;
use App\Models\ResourceStack;
use App\Models\ResourceType;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrgCompetitionTest extends TestCase
{
    use RefreshDatabase;

    private User $me;
    private User $mate;
    private User $rival;
    private Org $mine;
    private Org $other;
    private ResourceType $ore;
    private Location $hangar;

    protected function setUp(): void
    {
        parent::setUp();
        CarbonImmutable::setTestNow('2956-11-20 12:00:00');
        \Illuminate\Support\Carbon::setTestNow('2956-11-20 12:00:00');

        $this->me = User::factory()->create(['discord_id' => '1', 'handle' => 'Raven']);
        $this->mate = User::factory()->create(['discord_id' => '2', 'handle' => 'Ash']);
        $this->rival = User::factory()->create(['discord_id' => '3', 'handle' => 'Zed']);
        $pending = User::factory()->create(['discord_id' => '4', 'handle' => 'Pending']);

        $this->mine = Org::create(['name' => 'Syndikatet', 'sid' => 'SYN']);
        $this->mine->memberships()->attach($this->me->id, ['role' => 'manager', 'status' => 'active']);
        $this->mine->memberships()->attach($this->mate->id, ['role' => 'member', 'status' => 'active']);
        $this->mine->memberships()->attach($pending->id, ['role' => 'member', 'status' => 'pending']);
        $this->other = Org::create(['name' => 'Nordlys']);
        $this->other->memberships()->attach($this->rival->id, ['role' => 'member', 'status' => 'active']);

        $this->ore = ResourceType::create(['name' => 'Quantanium', 'category' => 'ore', 'unit' => 'mscu']);
        $this->hangar = Location::create(['name' => 'Area18', 'kind' => 'landing_zone', 'system' => 'Stanton']);

        // Blueprints: we learn three distinct (one twice), the rival one.
        $this->blueprint($this->me, 'Atlas', '2956-11-02');
        $this->blueprint($this->mate, 'Atlas', '2956-11-03');
        $this->blueprint($this->mate, 'P4-AR', '2956-11-04');
        $this->blueprint($this->me, 'Karna', '2956-10-15'); // last month
        $this->blueprint($pending, 'Arrowhead', '2956-11-05'); // not an active member
        $this->blueprint($this->rival, 'Atlas', '2956-11-06');

        // Missions: the rival does more this month.
        $this->mission($this->me, '2956-11-10');
        $this->mission($this->rival, '2956-11-11');
        $this->mission($this->rival, '2956-11-12');
        $this->mission($this->rival, '2956-10-01');

        // Resources: org-visible stacks only.
        $this->stack($this->me, 40_000, 'org', '2956-11-08');
        $this->stack($this->mate, 10_000, 'org', '2956-10-08');
        $this->stack($this->me, 999_000, 'private', '2956-11-08');
        $this->stack($this->rival, 20_000, 'org', '2956-11-09');

        Sanctum::actingAs($this->me);
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        \Illuminate\Support\Carbon::setTestNow();
        parent::tearDown();
    }

    private function blueprint(User $u, string $name, string $at): void
    {
        BlueprintOwned::create(['user_id' => $u->id, 'blueprint_name' => $name, 'acquired_at' => $at, 'source' => 'log']);
    }

    private function mission(User $u, string $at): void
    {
        DB::table('ingest_events')->insert([
            'user_id' => $u->id, 'event_type' => 'mission_completed', 'payload' => '{"detail":"Bounty"}',
            'log_timestamp' => $at, 'fingerprint' => sha1(uniqid('', true)), 'created_at' => $at, 'updated_at' => $at,
        ]);
    }

    private function stack(User $u, int $mscu, string $visibility, string $at): void
    {
        $stack = ResourceStack::create([
            'user_id' => $u->id, 'location_id' => $this->hangar->id, 'resource_type_id' => $this->ore->id,
            'quality' => 500, 'quantity' => $mscu, 'visibility' => $visibility, 'source' => 'manual',
        ]);
        DB::table('resource_stacks')->where('id', $stack->id)->update(['created_at' => $at]);
    }

    public function test_this_month_counts_only_this_month_and_active_members(): void
    {
        $res = $this->getJson('/api/dashboard/competition?period=month')->assertOk()->json();

        $this->assertSame('month', $res['period']);
        $this->assertSame($this->mine->id, $res['my_org_id']);
        $this->assertSame(['Syndikatet', 'Nordlys'], array_column($res['orgs'], 'name'));

        [$us, $them] = $res['orgs'];
        $this->assertSame(2, $us['blueprints'], 'Atlas once, P4-AR; Karna is last month, Arrowhead is pending');
        $this->assertSame(1, $us['missions']);
        $this->assertEquals(40.0, $us['resources_scu'], 'private stack and last month left out');
        $this->assertSame(2, $us['member_count']);
        $this->assertTrue($us['mine']);
        $this->assertFalse($them['mine']);

        // Us: 1000 + 500 + 1000; them: 500 + 1000 + 500.
        $this->assertSame(2500, $us['score']);
        $this->assertSame(2000, $them['score']);
        $this->assertSame(['blueprints' => 1, 'missions' => 2, 'resources_scu' => 1, 'overall' => 1], $us['rank']);
        $this->assertSame(1, $them['rank']['missions']);

        $this->assertSame(['mine' => 1, 'org' => 2], $res['contribution']['blueprints']);
        $this->assertSame(['mine' => 1, 'org' => 1], $res['contribution']['missions']);
    }

    public function test_all_time_includes_everything_and_reports_trend(): void
    {
        $res = $this->getJson('/api/dashboard/competition?period=all')->assertOk()->json();

        $us = collect($res['orgs'])->firstWhere('name', 'Syndikatet');
        $this->assertSame(3, $us['blueprints']);
        $this->assertEquals(50.0, $us['resources_scu']);
        $this->assertNull($res['from']);
        $this->assertIsInt($us['trend']);
    }

    public function test_period_is_validated(): void
    {
        $this->getJson('/api/dashboard/competition?period=year')->assertUnprocessable();
    }

    public function test_ingest_accepts_mission_completed(): void
    {
        $res = $this->postJson('/api/ingest/events', ['events' => [
            ['kind' => 'mission_completed', 'timestamp' => '2956-11-19T10:00:00Z', 'detail' => 'Eliminate All'],
            ['kind' => 'blueprint', 'timestamp' => '2956-11-19T10:01:00Z', 'detail' => 'Arclight'],
        ]])->assertOk()->json();

        $this->assertSame(2, $res['accepted']);
        $this->assertSame(1, $res['missions_completed']);
        $this->assertSame(1, $res['blueprints_added']);
        $this->assertSame(0, $res['ignored']);
    }
}
