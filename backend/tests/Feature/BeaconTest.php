<?php

namespace Tests\Feature;

use App\Models\Beacon;
use App\Models\Org;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Location beacons from the desktop client, shared with org mates, moved between players as a file. */
class BeaconTest extends TestCase
{
    use RefreshDatabase;

    private const SHARD = 'SolarSystem_926901609997';

    private int $discord = 500;

    private function player(array $attributes = []): User
    {
        return User::factory()->create($attributes + ['discord_id' => (string) $this->discord++]);
    }

    private function beacon(array $overrides = []): array
    {
        return $overrides + [
            'name' => 'Area18 2',
            'shard' => self::SHARD,
            'frame' => 'OOC_Stanton_3_ArcCorp',
            'pos' => [-123456.5, 2.25e10, 300],
            'system' => 'Stanton',
            'location' => 'Stanton3 Area18 (LZ : Stanton3 Area18)',
            'server' => 'pub-euw1b-sc-alpha-4100-13190956-game-53',
            'set_at' => '2026-11-24T10:00:00+00:00',
        ];
    }

    private function place(User $user, array $overrides = []): Beacon
    {
        $b = $this->beacon($overrides);

        return Beacon::create([
            'user_id' => $user->id, 'name' => $b['name'], 'shard' => $b['shard'], 'frame' => $b['frame'],
            'pos_x' => $b['pos'][0], 'pos_y' => $b['pos'][1], 'pos_z' => $b['pos'][2],
            'set_at' => $b['set_at'], 'shared' => $overrides['shared'] ?? false,
        ]);
    }

    public function test_the_client_sets_a_beacon(): void
    {
        $me = $this->player(['handle' => 'RavenMind']);

        $res = $this->actingAs($me)->postJson('/api/beacons', $this->beacon())->assertCreated();
        $res->assertJsonPath('data.name', 'Area18 2')
            ->assertJsonPath('data.shard', self::SHARD)
            ->assertJsonPath('data.frame', 'OOC_Stanton_3_ArcCorp')
            ->assertJsonPath('data.system', 'Stanton')
            ->assertJsonPath('data.shared', false)
            ->assertJsonPath('data.mine', true)
            ->assertJsonPath('data.owner', ['id' => $me->id, 'name' => 'RavenMind']);
        $this->assertEquals([-123456.5, 2.25e10, 300.0], $res->json('data.pos'));
        $this->assertSame('2026-11-24T10:00:00+00:00', $res->json('data.set_at'));

        // Without a time, it is now; sharing can be asked for at once.
        $this->postJson('/api/beacons', ['set_at' => null, 'shared' => true] + $this->beacon(['name' => 'Rock']))
            ->assertCreated()->assertJsonPath('data.shared', true);
        $this->assertSame(['Rock', 'Area18 2'], array_column($this->getJson('/api/beacons')->json('data'), 'name'));
    }

    public function test_a_beacon_is_validated_strictly(): void
    {
        $me = $this->player();
        $this->actingAs($me);

        foreach ([
            'pos' => ['pos' => [1, 2]],
            'pos.2' => ['pos' => [1, 2, '3']],
            'pos.1' => ['pos' => [1, null, 3]],
            'shard' => ['shard' => 'pub_euw1b_13165946_320'],
            'frame' => ['frame' => ''],
            'name' => ['name' => str_repeat('x', 81)],
        ] as $field => $bad) {
            $this->postJson('/api/beacons', $this->beacon($bad))->assertUnprocessable()->assertJsonValidationErrors($field);
        }
        $this->postJson('/api/beacons', $this->beacon(['frame' => str_repeat('f', 121)]))->assertJsonValidationErrors('frame');
        $this->postJson('/api/beacons', $this->beacon(['pos' => ['x' => 1, 'y' => 2, 'z' => 3]]))->assertJsonValidationErrors('pos');
        $this->assertSame(0, Beacon::count());
    }

    public function test_the_list_holds_mine_and_what_org_mates_share(): void
    {
        $me = $this->player(['handle' => 'Raven']);
        $mate = $this->player(['handle' => 'Froggy']);
        $pending = $this->player(['handle' => 'Waiting']);
        $stranger = $this->player(['handle' => 'Zed']);
        $org = Org::create(['name' => 'Syndikatet']);
        $other = Org::create(['name' => 'Nordlys']);
        $org->memberships()->attach($me->id, ['role' => 'member', 'status' => 'active']);
        $org->memberships()->attach($mate->id, ['role' => 'member', 'status' => 'active']);
        $org->memberships()->attach($pending->id, ['role' => 'member', 'status' => 'pending']);
        $other->memberships()->attach($stranger->id, ['role' => 'member', 'status' => 'active']);

        $this->place($me, ['name' => 'Mine old', 'set_at' => '2026-11-01T00:00:00Z']);
        $this->place($me, ['name' => 'Mine new', 'set_at' => '2026-11-20T00:00:00Z']);
        $this->place($mate, ['name' => 'Mate shared', 'shared' => true, 'set_at' => '2026-11-23T00:00:00Z']);
        $this->place($mate, ['name' => 'Mate private']);
        $this->place($pending, ['name' => 'Pending shared', 'shared' => true]);
        $this->place($stranger, ['name' => 'Other org shared', 'shared' => true]);

        $data = $this->actingAs($me)->getJson('/api/beacons')->assertOk()->json('data');
        $this->assertSame(['Mine new', 'Mine old', 'Mate shared'], array_column($data, 'name'), 'own first, newest first');
        $this->assertFalse($data[2]['mine']);
        $this->assertSame('Froggy', $data[2]['owner']['name']);

        // A solo player sees only their own.
        $this->assertSame(['Other org shared'], array_column($this->actingAs($stranger)->getJson('/api/beacons')->json('data'), 'name'));
    }

    public function test_only_the_owner_renames_shares_or_deletes(): void
    {
        $me = $this->player();
        $mate = $this->player();
        $org = Org::create(['name' => 'Syndikatet']);
        $org->memberships()->attach($me->id, ['role' => 'member', 'status' => 'active']);
        $org->memberships()->attach($mate->id, ['role' => 'manager', 'status' => 'active']);
        $beacon = $this->place($me, ['shared' => true]);

        $this->actingAs($mate)->patchJson("/api/beacons/{$beacon->id}", ['name' => 'Mine now'])->assertForbidden();
        $this->actingAs($mate)->deleteJson("/api/beacons/{$beacon->id}")->assertForbidden();
        $this->assertModelExists($beacon);

        $this->actingAs($me)->patchJson("/api/beacons/{$beacon->id}", ['name' => 'Hangar door', 'shared' => false])
            ->assertOk()->assertJsonPath('data.name', 'Hangar door')->assertJsonPath('data.shared', false);
        $this->actingAs($me)->patchJson("/api/beacons/{$beacon->id}", ['name' => ''])->assertJsonValidationErrors('name');
        $this->actingAs($me)->deleteJson("/api/beacons/{$beacon->id}")->assertNoContent();
        $this->assertModelMissing($beacon);
    }

    public function test_the_client_reports_its_shard(): void
    {
        $me = $this->player();
        $this->actingAs($me)->getJson('/api/me/shard')->assertOk()->assertExactJson(['shard' => null, 'at' => null]);

        $this->putJson('/api/me/shard', ['shard' => 'pub_euw1b'])->assertJsonValidationErrors('shard');
        $this->putJson('/api/me/shard', ['shard' => self::SHARD])->assertOk()->assertJsonPath('shard', self::SHARD);
        $this->assertNotNull($this->getJson('/api/me/shard')->json('at'));
        $this->assertSame(self::SHARD, $this->getJson('/api/me')->json('current_shard'));

        $this->putJson('/api/me/shard', ['shard' => null])->assertOk()->assertJsonPath('shard', null);
    }

    public function test_an_export_file_imports_as_own_unshared_copies(): void
    {
        $me = $this->player();
        $friend = $this->player();
        $theirs = $this->place($friend, ['name' => 'Their cave', 'shared' => true]);
        $file = ['format' => 'starbuddy-beacons', 'version' => 1, 'beacons' => [
            $this->beacon(['name' => 'Same shard']),
            $this->beacon(['name' => 'Elsewhere', 'shard' => 'SolarSystem_111', 'frame' => 'SolarSystem_111', 'system' => null]),
        ]];

        // Nothing reported yet: nothing to compare.
        $res = $this->actingAs($me)->postJson('/api/beacons/import', $file)->assertCreated();
        $res->assertJsonPath('current_shard', null)->assertJsonPath('other_shard', []);
        $this->assertSame([false, false], array_column($res->json('data'), 'shared'));

        $me->forceFill(['current_shard' => self::SHARD])->save();
        $res = $this->postJson('/api/beacons/import', $file)->assertCreated();
        $elsewhere = collect($res->json('data'))->firstWhere('name', 'Elsewhere')['id'];
        $res->assertJsonPath('current_shard', self::SHARD)->assertJsonPath('other_shard', [$elsewhere]);
        $this->assertSame(4, Beacon::where('user_id', $me->id)->count());
        $this->assertSame('Their cave', $theirs->fresh()->name);

        // Not an export file, or a bad beacon in it: nothing is imported.
        $this->postJson('/api/beacons/import', ['format' => 'other'] + $file)->assertJsonValidationErrors('format');
        $this->postJson('/api/beacons/import', ['version' => 2] + $file)->assertJsonValidationErrors('version');
        $file['beacons'][] = $this->beacon(['pos' => [1, 2]]);
        $this->postJson('/api/beacons/import', $file)->assertJsonValidationErrors('beacons.2.pos');
        $this->assertSame(4, Beacon::where('user_id', $me->id)->count());
    }

    public function test_beacons_are_in_the_data_export_and_go_with_the_account(): void
    {
        $me = $this->player();
        $this->place($me, ['name' => 'Hidden cave']);

        $this->actingAs($me)->get('/api/me/export')->assertOk()->assertJsonPath('data.beacons.0.name', 'Hidden cave');
        $this->deleteJson('/api/me', ['confirm' => 'DELETE'])->assertNoContent();
        $this->assertSame(0, DB::table('beacons')->count());
    }
}
