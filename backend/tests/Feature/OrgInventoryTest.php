<?php

namespace Tests\Feature;

use App\Models\ItemStack;
use App\Models\Location;
use App\Models\Org;
use App\Models\ResourceStack;
use App\Models\ResourceType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrgInventoryTest extends TestCase
{
    use RefreshDatabase;

    private User $me;
    private User $mate;
    private User $stranger;
    private Location $hangar;
    private Location $pyro;

    protected function setUp(): void
    {
        parent::setUp();
        $this->me = User::factory()->create(['discord_id' => '1', 'handle' => 'Raven']);
        $this->mate = User::factory()->create(['discord_id' => '2', 'handle' => 'Ash']);
        $this->stranger = User::factory()->create(['discord_id' => '3', 'handle' => 'Zed']);
        $pending = User::factory()->create(['discord_id' => '4', 'handle' => 'Pending']);
        $org = Org::create(['name' => 'Stellar Forge']);
        $org->memberships()->attach($this->me->id, ['role' => 'admin', 'status' => 'active']);
        $org->memberships()->attach($this->mate->id, ['role' => 'member', 'status' => 'active']);
        $org->memberships()->attach($pending->id, ['role' => 'member', 'status' => 'pending']);
        $this->hangar = Location::create(['name' => 'Area18', 'kind' => 'landing_zone', 'system' => 'Stanton']);
        $this->pyro = Location::create(['name' => 'Pyro Gateway', 'kind' => 'station', 'system' => 'Pyro']);
        Sanctum::actingAs($this->me);

        $item = fn (User $u, string $class, ?string $name, int $qty, string $vis = 'org', ?Location $loc = null) => ItemStack::create([
            'user_id' => $u->id, 'location_id' => ($loc ?? $this->hangar)->id, 'item_class' => $class,
            'item_name' => $name, 'quantity' => $qty, 'visibility' => $vis,
        ]);
        $item($this->me, 'QDRV_Atlas', 'Atlas', 2);
        $item($this->me, 'qdrv_atlas', 'Atlas (Q450)', 1, 'org', $this->pyro); // crafted, case-variant class
        $item($this->mate, 'QDRV_Atlas', 'Atlas', 5);
        $item($this->mate, 'behr_p4ar', 'P4-AR Rifle', 3);
        $item($this->me, 'behr_p4ar', 'P4-AR Rifle', 9, 'private');   // not offered to the org
        $item($this->stranger, 'QDRV_Atlas', 'Atlas', 100);           // not in the org
        $item($pending, 'QDRV_Atlas', 'Atlas', 100);                  // membership not active
    }

    public function test_items_group_by_class_with_totals_and_per_member_holdings(): void
    {
        $res = $this->getJson('/api/org/items')->assertOk()->json();

        $this->assertSame(['Ash', 'Raven'], array_column($res['members'], 'handle'), 'active members only, viewer included');
        $this->assertSame(['Atlas', 'P4-AR Rifle'], array_column($res['data'], 'name'));

        $atlas = $res['data'][0];
        $this->assertSame(8, $atlas['total']);
        $this->assertSame(3, $atlas['stacks']);
        $this->assertSame(2, $atlas['holder_count']);
        $this->assertSame(['quantity' => 3, 'stacks' => 2], $atlas['holders'][$this->me->id]);
        $this->assertSame(['quantity' => 5, 'stacks' => 1], $atlas['holders'][$this->mate->id]);

        $rifle = $res['data'][1];
        $this->assertSame(3, $rifle['total'], 'my private stack is not org inventory');
        $this->assertArrayNotHasKey($this->me->id, $rifle['holders']);
    }

    public function test_items_filters_and_sorting(): void
    {
        $names = fn (string $qs) => array_column($this->getJson("/api/org/items?{$qs}")->assertOk()->json('data'), 'name');

        $this->assertSame(['P4-AR Rifle'], $names('search=rifle'));
        $this->assertSame(['Atlas'], $names('system=Pyro'));
        $this->assertSame(1, $this->getJson('/api/org/items?system=Pyro')->json('data.0.total'), 'filters narrow the stacks that are summed');
        $this->assertSame(['Atlas', 'P4-AR Rifle'], $names('sort=total&dir=desc'));
        $this->assertSame(['P4-AR Rifle', 'Atlas'], $names('sort=stacks&dir=asc'));
        $this->assertSame(['P4-AR Rifle', 'Atlas'], $names('sort=holders&dir=asc'));
    }

    public function test_materials_group_by_type_and_quality(): void
    {
        $ti = ResourceType::create(['name' => 'Titanium', 'category' => 'refined', 'unit' => 'mscu']);
        $gem = ResourceType::create(['name' => 'Hadanite', 'category' => 'gem', 'unit' => 'pieces']);
        $stack = fn (User $u, ResourceType $t, int $q, int $qty, string $vis = 'org') => ResourceStack::create([
            'user_id' => $u->id, 'location_id' => $this->hangar->id, 'resource_type_id' => $t->id,
            'quality' => $q, 'quantity' => $qty, 'visibility' => $vis,
        ]);
        $stack($this->me, $ti, 500, 1000);
        $stack($this->mate, $ti, 500, 2500);
        $stack($this->mate, $ti, 700, 100);
        $stack($this->me, $gem, 0, 12);
        $stack($this->me, $ti, 500, 9999, 'private');

        $rows = $this->getJson('/api/org/materials')->assertOk()->json('data');

        $this->assertSame(
            [['Hadanite', 0], ['Titanium', 700], ['Titanium', 500]],
            array_map(fn ($r) => [$r['resource_type']['name'], $r['quality']], $rows),
            'by name, then highest quality first',
        );
        $ti500 = $rows[2];
        $this->assertSame(3500, $ti500['total']);
        $this->assertSame(2, $ti500['stacks']);
        $this->assertSame(['quantity' => 2500, 'stacks' => 1], $ti500['holders'][$this->mate->id]);
        $this->assertSame('pieces', $rows[0]['resource_type']['unit']);

        $this->assertCount(2, $this->getJson('/api/org/materials?search=tita')->json('data'));
        $this->assertCount(1, $this->getJson('/api/org/materials?quality_min=600')->json('data'));
        $this->assertSame([700, 500, 0], array_column($this->getJson('/api/org/materials?sort=quality&dir=desc')->json('data'), 'quality'));
    }
}
