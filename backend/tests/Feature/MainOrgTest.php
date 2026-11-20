<?php

namespace Tests\Feature;

use App\Models\Org;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Every player in an org has a main org, as in Star Citizen; a manager
 * leaving an org with no other manager appoints one.
 */
class MainOrgTest extends TestCase
{
    use RefreshDatabase;

    private User $me;
    private User $mate;
    private Org $first;
    private Org $second;

    protected function setUp(): void
    {
        parent::setUp();
        $this->me = User::factory()->create(['discord_id' => '1', 'handle' => 'Raven']);
        $this->mate = User::factory()->create(['discord_id' => '2', 'handle' => 'Froggy']);
        $boss = User::factory()->create(['discord_id' => '3', 'handle' => 'Boss']);

        $this->first = Org::create(['name' => 'Syndikatet']);
        $this->first->memberships()->attach($boss->id, ['role' => 'manager', 'status' => 'active']);
        $this->second = Org::create(['name' => 'Nordlys']);
        $this->second->memberships()->attach($boss->id, ['role' => 'manager', 'status' => 'active']);
        $this->boss = $boss;
    }

    private User $boss;

    private function joinAndAccept(User $user, Org $org): void
    {
        $this->actingAs($user)->postJson("/api/orgs/{$org->id}/join")->assertCreated();
        $this->actingAs($this->boss)->postJson("/api/orgs/{$org->id}/members/{$user->id}/accept")->assertNoContent();
        $user->refresh(); // as the next request would load it
    }

    public function test_the_first_org_becomes_main_and_a_later_one_waits_to_be_picked(): void
    {
        $this->joinAndAccept($this->me, $this->second);
        $this->joinAndAccept($this->me, $this->first);

        $me = $this->actingAs($this->me)->getJson('/api/me')->assertOk()->json();
        $this->assertSame($this->second->id, $me['main_org_id']);
        $this->assertSame($this->second->id, $me['orgs'][0]['id'], 'orgs[0] is the main org');

        $this->actingAs($this->me)->putJson('/api/me/main-org', ['org_id' => $this->first->id])->assertOk();
        $this->assertSame($this->first->id, $this->getJson('/api/me')->json('orgs.0.id'));

        // Points go to the main org.
        $this->postJson('/api/ingest/events', ['events' => [['kind' => 'mission_completed', 'timestamp' => now()->toIso8601String(), 'detail' => 'A']]])->assertOk();
        $this->assertSame($this->first->id, DB::table('score_events')->value('org_id'));

        $outsider = Org::create(['name' => 'Elsewhere']);
        $this->putJson('/api/me/main-org', ['org_id' => $outsider->id])->assertUnprocessable();
    }

    public function test_leaving_the_main_org_moves_main_to_another(): void
    {
        $this->joinAndAccept($this->me, $this->first);
        $this->joinAndAccept($this->me, $this->second);

        $this->actingAs($this->me)->deleteJson("/api/orgs/{$this->first->id}/leave")->assertNoContent();
        $this->assertSame($this->second->id, $this->me->fresh()->main_org_id);

        $this->actingAs($this->me)->deleteJson("/api/orgs/{$this->second->id}/leave")->assertNoContent();
        $this->assertNull($this->me->fresh()->main_org_id);
    }

    public function test_the_last_manager_appoints_a_successor_before_leaving(): void
    {
        $this->joinAndAccept($this->me, $this->first);
        $this->joinAndAccept($this->mate, $this->first);
        $this->first->memberships()->updateExistingPivot($this->me->id, ['role' => 'manager']);

        // Another manager remains: free to go.
        $this->actingAs($this->boss)->deleteJson("/api/orgs/{$this->first->id}/leave")->assertNoContent();

        // Now I am the last one.
        $res = $this->actingAs($this->me)->deleteJson("/api/orgs/{$this->first->id}/leave")->assertUnprocessable();
        $this->assertSame('successor_required', $res->json('code'));
        $this->assertSame([['id' => $this->mate->id, 'handle' => 'Froggy']], $res->json('candidates'));

        $this->actingAs($this->me)->deleteJson("/api/orgs/{$this->first->id}/leave", ['successor_id' => 999])->assertUnprocessable();
        $this->actingAs($this->me)->deleteJson("/api/orgs/{$this->first->id}/leave", ['successor_id' => $this->mate->id])->assertNoContent();

        $this->assertSame('manager', $this->first->memberships()->where('users.id', $this->mate->id)->first()->pivot->role);
        $this->assertFalse($this->first->memberships()->where('users.id', $this->me->id)->exists());

        // The last member of all may simply leave.
        $this->actingAs($this->mate)->deleteJson("/api/orgs/{$this->first->id}/leave")->assertNoContent();
    }
}
