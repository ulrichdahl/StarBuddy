<?php

namespace Tests\Feature;

use App\Models\Location;
use App\Models\Org;
use App\Models\RefineryOrder;
use App\Models\ResourceStack;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * A refinery order is a job, not a note that something finished: its yields
 * exist as stacks from the moment it is recorded, sit at the refinery marked as
 * refining, and move when the order is collected.
 */
class RefineryOrderTest extends TestCase
{
    use RefreshDatabase;

    private User $me;
    private int $hangarId;

    protected function setUp(): void
    {
        parent::setUp();
        $org = Org::create(['name' => 'Stellar Forge']);
        $this->me = User::factory()->create(['discord_id' => '1', 'handle' => 'DK-Raven']);
        $org->memberships()->attach($this->me->id, ['role' => 'member', 'status' => 'active']);

        foreach ([['Corundum Ore', 'ore', 'mscu'], ['Aluminum Ore', 'ore', 'mscu'], ['Hadanite', 'gem', 'pieces']] as [$name, $category, $unit]) {
            DB::table('resource_types')->insert([
                'name' => $name, 'category' => $category, 'unit' => $unit,
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        $this->hangarId = Location::create([
            'user_id' => $this->me->id, 'kind' => 'hangar', 'name' => 'Area18 hangar',
        ])->id;
    }

    /** @return array<string, mixed> */
    private function order(array $overrides = []): array
    {
        return array_merge([
            'station' => 'LEVSKI',
            'method' => 'Pyrometric Chromalysis',
            'work_order_number' => 1,
            'state' => 'processing',
            'unit' => 'cSCU',
            'duration_seconds' => 967,
            'cost' => 281.00,
            'yield_total' => 115.31,
            'source' => 'ocr',
            'materials' => [
                // Refined: 99 cSCU of corundum at quality 504.
                ['resource' => 'CORUNDUM', 'quality' => 504, 'qty' => 204, 'yield_amount' => 99, 'refine' => true],
                // Switched off — the panel computed no yield for it.
                ['resource' => 'IRON', 'quality' => 325, 'qty' => 1005, 'yield_amount' => null, 'refine' => false],
                // Inert material yields nothing.
                ['resource' => 'INERT MATERIALS', 'quality' => 0, 'qty' => 241, 'yield_amount' => 0, 'refine' => false],
            ],
        ], $overrides);
    }

    public function test_a_captured_order_records_its_source_and_its_refinery_as_a_location(): void
    {
        $response = $this->actingAs($this->me)
            ->postJson('/api/refinery-orders', $this->order())
            ->assertCreated()
            ->assertJsonPath('source', 'ocr')
            ->assertJsonPath('station', 'LEVSKI')
            ->assertJsonPath('unit', 'cSCU')
            ->assertJsonPath('open', true);

        // The refinery is a place, so its yields have somewhere to sit.
        $location = Location::where('kind', 'refinery')->sole();
        $this->assertSame('LEVSKI', $location->name);
        $this->assertSame($location->id, $response->json('location.id'));
    }

    public function test_a_second_order_reuses_the_same_refinery_location(): void
    {
        $this->actingAs($this->me)->postJson('/api/refinery-orders', $this->order())->assertCreated();
        $this->actingAs($this->me)
            ->postJson('/api/refinery-orders', $this->order(['work_order_number' => 2]))
            ->assertCreated();

        $this->assertSame(1, Location::where('kind', 'refinery')->count(), 'one Levski, not one per order');
    }

    public function test_only_the_rows_being_refined_become_stacks(): void
    {
        $this->actingAs($this->me)->postJson('/api/refinery-orders', $this->order())->assertCreated();

        $stack = ResourceStack::sole();
        $this->assertSame('Corundum Ore', $stack->resourceType->name, 'CORUNDUM resolves to the ore');
        $this->assertSame(504, $stack->quality);
        // 99 cSCU is 990 mSCU; reading it as SCU would be a hundredfold out.
        $this->assertSame(990, $stack->quantity);
        $this->assertTrue($stack->refining);
        $this->assertSame('LEVSKI', $stack->refining_at);
    }

    public function test_refining_stacks_show_in_the_materials_list_marked_as_refining(): void
    {
        $this->actingAs($this->me)->postJson('/api/refinery-orders', $this->order())->assertCreated();

        $this->actingAs($this->me)
            ->getJson('/api/resource-stacks')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.refining', true)
            ->assertJsonPath('data.0.refining_at', 'LEVSKI');
    }

    public function test_collecting_moves_the_materials_and_clears_the_marker(): void
    {
        $id = $this->actingAs($this->me)
            ->postJson('/api/refinery-orders', $this->order())
            ->assertCreated()
            ->json('id');

        $this->actingAs($this->me)
            ->postJson("/api/refinery-orders/{$id}/collect", ['location_id' => $this->hangarId])
            ->assertOk()
            ->assertJsonPath('open', false)
            ->assertJsonPath('collected_location.id', $this->hangarId);

        $stack = ResourceStack::sole();
        $this->assertSame($this->hangarId, $stack->location_id, 'the materials moved to the hangar');
        $this->assertFalse($stack->fresh()->refining, 'and are no longer refining');
        // The link stays as provenance: this ore came out of that order.
        $this->assertSame($id, $stack->refinery_order_id);
    }

    public function test_an_order_cannot_be_collected_twice(): void
    {
        $id = $this->actingAs($this->me)
            ->postJson('/api/refinery-orders', $this->order())
            ->assertCreated()
            ->json('id');

        $this->actingAs($this->me)
            ->postJson("/api/refinery-orders/{$id}/collect", ['location_id' => $this->hangarId])
            ->assertOk();
        $this->actingAs($this->me)
            ->postJson("/api/refinery-orders/{$id}/collect", ['location_id' => $this->hangarId])
            ->assertStatus(422);
    }

    public function test_a_material_the_catalogue_does_not_know_is_reported_not_dropped(): void
    {
        $this->actingAs($this->me)
            ->postJson('/api/refinery-orders', $this->order([
                'materials' => [
                    ['resource' => 'RICCITE', 'quality' => 700, 'yield_amount' => 40, 'refine' => true],
                ],
            ]))
            ->assertCreated()
            ->assertJsonPath('unmatched', ['RICCITE']);

        // The order is still worth having even though no stack could be made.
        $this->assertSame(1, RefineryOrder::count());
        $this->assertSame(0, ResourceStack::count());
    }

    /**
     * Resource names come from the game's global.ini, which players replace: a
     * localisation mod can strip "Ore" from every name. Neither side can assume
     * the suffix, so both are reduced before they are compared.
     */
    public function test_material_names_match_whether_or_not_they_carry_ore(): void
    {
        // The catalogue as a language mod leaves it: no "Ore" anywhere.
        DB::table('resource_types')->insert([
            'name' => 'Bexalite', 'category' => 'ore', 'unit' => 'mscu',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->actingAs($this->me)
            ->postJson('/api/refinery-orders', $this->order([
                'materials' => [
                    // Catalogue has "Corundum Ore", the terminal printed the refined name.
                    ['resource' => 'CORUNDUM', 'quality' => 504, 'yield_amount' => 99, 'refine' => true],
                    // Catalogue has no suffix either; still the same material.
                    ['resource' => 'BEXALITE', 'quality' => 700, 'yield_amount' => 50, 'refine' => true],
                    // And a name that arrives carrying the marker anyway.
                    ['resource' => 'Aluminum (Ore)', 'quality' => 310, 'yield_amount' => 20, 'refine' => true],
                ],
            ]))
            ->assertCreated()
            ->assertJsonPath('unmatched', []);

        $this->assertSame(
            ['Aluminum Ore', 'Bexalite', 'Corundum Ore'],
            ResourceStack::with('resourceType')->get()
                ->map(fn ($s) => $s->resourceType->name)->sort()->values()->all(),
        );
    }

    /** Only a standalone "ore" is dropped, never a word that contains it. */
    public function test_reducing_a_name_does_not_swallow_part_of_another_word(): void
    {
        DB::table('resource_types')->insert([
            'name' => 'Inert Materials', 'category' => 'ore', 'unit' => 'mscu',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->actingAs($this->me)
            ->postJson('/api/refinery-orders', $this->order([
                'materials' => [
                    ['resource' => 'INERT MATERIALS', 'quality' => 0, 'yield_amount' => 12, 'refine' => true],
                ],
            ]))
            ->assertCreated()
            ->assertJsonPath('unmatched', []);

        $this->assertSame('Inert Materials', ResourceStack::sole()->resourceType->name);
    }

    /** A haul is the player's own until they say otherwise. */
    public function test_yields_are_private_unless_asked_otherwise(): void
    {
        $this->actingAs($this->me)
            ->postJson('/api/refinery-orders', $this->order())
            ->assertCreated()
            ->assertJsonPath('visibility', 'private');
        $this->assertSame('private', ResourceStack::sole()->visibility);

        $this->actingAs($this->me)
            ->postJson('/api/refinery-orders', $this->order(['work_order_number' => 2, 'visibility' => 'org']))
            ->assertCreated()
            ->assertJsonPath('visibility', 'org');
        $this->assertSame('org', ResourceStack::latest('id')->first()->visibility);
    }

    public function test_collecting_can_share_the_haul_with_the_org(): void
    {
        $id = $this->actingAs($this->me)
            ->postJson('/api/refinery-orders', $this->order())
            ->assertCreated()
            ->json('id');

        $this->actingAs($this->me)
            ->postJson("/api/refinery-orders/{$id}/collect", [
                'location_id' => $this->hangarId,
                'visibility' => 'org',
            ])
            ->assertOk()
            ->assertJsonPath('visibility', 'org');

        $this->assertSame('org', ResourceStack::sole()->visibility);
    }

    /** Collecting without saying leaves a private haul private. */
    public function test_collecting_does_not_quietly_reshare(): void
    {
        $id = $this->actingAs($this->me)
            ->postJson('/api/refinery-orders', $this->order())
            ->assertCreated()
            ->json('id');

        $this->actingAs($this->me)
            ->postJson("/api/refinery-orders/{$id}/collect", ['location_id' => $this->hangarId])
            ->assertOk();

        $this->assertSame('private', ResourceStack::sole()->visibility);
    }

    public function test_the_show_view_carries_the_whole_capture(): void
    {
        $id = $this->actingAs($this->me)
            ->postJson('/api/refinery-orders', $this->order([
                'capture' => ['lines' => [['text' => 'PYROMETRIC CHROMALYSIS']], 'captures' => 2],
            ]))
            ->assertCreated()
            ->json('id');

        $this->actingAs($this->me)
            ->getJson("/api/refinery-orders/{$id}")
            ->assertOk()
            ->assertJsonPath('capture.captures', 2)
            ->assertJsonPath('stacks.0.resource', 'Corundum Ore')
            ->assertJsonPath('method', 'Pyrometric Chromalysis');
    }

    public function test_open_filters_the_list_to_what_the_refinery_still_holds(): void
    {
        $open = $this->actingAs($this->me)->postJson('/api/refinery-orders', $this->order())->json('id');
        $done = $this->actingAs($this->me)
            ->postJson('/api/refinery-orders', $this->order(['work_order_number' => 2]))
            ->json('id');
        $this->actingAs($this->me)
            ->postJson("/api/refinery-orders/{$done}/collect", ['location_id' => $this->hangarId])
            ->assertOk();

        $this->actingAs($this->me)
            ->getJson('/api/refinery-orders?open=1')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $open);
    }

    public function test_locations_can_be_filtered_to_refineries(): void
    {
        $this->actingAs($this->me)->postJson('/api/refinery-orders', $this->order())->assertCreated();

        // Not every place has a refinery, so placing an order only offers those.
        $refineries = $this->actingAs($this->me)->getJson('/api/locations?kind=refinery')->assertOk()->json();
        $this->assertCount(1, $refineries);
        $this->assertSame('LEVSKI', $refineries[0]['name']);

        // The unfiltered list still has the hangar for collection.
        $all = $this->actingAs($this->me)->getJson('/api/locations')->assertOk()->json();
        $this->assertCount(2, $all);
    }

    public function test_a_completion_from_an_older_client_no_longer_invents_an_order(): void
    {
        $this->actingAs($this->me)
            ->postJson('/api/ingest/events', [
                'events' => [[
                    'kind' => 'refinery_completed',
                    'timestamp' => now()->toIso8601String(),
                    'detail' => 'ARCCORP 141',
                ]],
            ])
            ->assertOk()
            ->assertJsonPath('ignored', 1);

        $this->assertSame(0, RefineryOrder::count(), 'orders come from the terminal now');
    }
}
