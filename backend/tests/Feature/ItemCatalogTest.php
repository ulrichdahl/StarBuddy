<?php

namespace Tests\Feature;

use App\Models\Item;
use App\Models\ItemStack;
use App\Models\Location;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ItemCatalogTest extends TestCase
{
    use RefreshDatabase;

    public function test_sync_maps_wiki_items_and_skips_placeholders(): void
    {
        Http::fake([
            'api.star-citizen.wiki/api/v2/items*' => Http::response([
                'data' => [
                    [
                        'uuid' => 'u1', 'name' => 'P4-AR Rifle', 'class_name' => 'behr_rifle_ballistic_01',
                        'type' => 'WeaponPersonal', 'type_label' => 'Personal Weapon',
                        'sub_type' => 'Rifle', 'sub_type_label' => 'Rifle',
                        'classification' => 'FPS.Weapon.Rifle', 'manufacturer' => ['name' => 'Behring Applied Technology'],
                        'size' => 3, 'grade' => 'UNDEFINED', 'is_craftable' => true,
                    ],
                    [
                        'uuid' => 'u2', 'name' => '<= PLACEHOLDER =>', 'class_name' => 'placeholder_01',
                        'type' => 'WeaponPersonal',
                    ],
                    [
                        'uuid' => 'u3', 'name' => 'Atlas Quantum Drive', 'class_name' => 'QDRV_RSI_S01_Atlas',
                        'type' => 'QuantumDrive', 'type_label' => 'Quantum Drive', 'sub_type' => 'UNDEFINED',
                        'manufacturer' => ['name' => 'Roberts Space Industries'], 'size' => 1, 'grade' => 'B',
                    ],
                ],
                'links' => ['next' => null],
            ]),
        ]);

        $this->artisan('starbuddy:sync-item-catalog')->assertSuccessful();

        $this->assertSame(2, Item::count());
        $rifle = Item::where('uuid', 'u1')->firstOrFail();
        $this->assertSame('Behring Applied Technology', $rifle->manufacturer);
        $this->assertNull($rifle->grade, 'UNDEFINED normalises to null');
        $this->assertTrue($rifle->is_craftable);
        $drive = Item::where('uuid', 'u3')->firstOrFail();
        $this->assertNull($drive->sub_type);
        $this->assertSame('B', $drive->grade);

        // Re-running refreshes rather than duplicates.
        $this->artisan('starbuddy:sync-item-catalog')->assertSuccessful();
        $this->assertSame(2, Item::count());
    }

    public function test_search_ranks_prefix_matches_first_and_matches_class_names(): void
    {
        Sanctum::actingAs(User::factory()->create(['discord_id' => '1', 'handle' => 'x']));
        foreach ([
            ['uuid' => 'a', 'name' => 'Arrowhead Sniper Rifle', 'class_name' => 'ksar_sniper'],
            ['uuid' => 'b', 'name' => 'Rifle Scope 4x', 'class_name' => 'scope_4x'],
            ['uuid' => 'c', 'name' => 'P4-AR', 'class_name' => 'behr_rifle_ballistic_01'],
            ['uuid' => 'd', 'name' => 'Medpen', 'class_name' => 'medpen_01'],
        ] as $row) {
            Item::create($row);
        }

        $names = collect($this->getJson('/api/items?search=rifle')->assertOk()->json())->pluck('name')->all();

        $this->assertSame(['Rifle Scope 4x', 'Arrowhead Sniper Rifle', 'P4-AR'], $names);
        $this->assertCount(4, $this->getJson('/api/items')->assertOk()->json());
        $this->assertCount(1, $this->getJson('/api/items?limit=1')->assertOk()->json());
    }

    public function test_item_stacks_filter_by_search_location_and_visibility(): void
    {
        $me = User::factory()->create(['discord_id' => '1', 'handle' => 'me']);
        Sanctum::actingAs($me);
        $hangar = Location::create(['name' => 'Area18 hangar', 'kind' => 'hangar', 'system' => 'Stanton', 'user_id' => $me->id]);
        $ship = Location::create(['name' => 'Cutlass', 'kind' => 'ship', 'user_id' => $me->id]);
        $stack = fn (array $a) => ItemStack::create($a + ['user_id' => $me->id, 'quantity' => 1, 'visibility' => 'private']);
        $stack(['item_class' => 'behr_rifle_ballistic_01', 'item_name' => 'P4-AR Rifle', 'location_id' => $hangar->id]);
        $stack(['item_class' => 'QDRV_RSI_S01_Atlas', 'item_name' => 'Atlas', 'location_id' => $ship->id, 'visibility' => 'org']);
        $stack(['item_class' => 'unknown_rifle_thing', 'item_name' => null, 'location_id' => $ship->id]);

        $names = fn (string $qs) => collect($this->getJson("/api/item-stacks?{$qs}")->assertOk()->json('data'))
            ->map(fn ($s) => $s['item_name'] ?? $s['item_class'])->sort()->values()->all();

        $this->assertSame(['P4-AR Rifle', 'unknown_rifle_thing'], $names('search=rifle'), 'search covers name and class');
        $this->assertSame(['Atlas', 'unknown_rifle_thing'], $names("location_id={$ship->id}"));
        $this->assertSame(['Atlas'], $names('visibility=org'));
        $this->assertSame(['Atlas'], $names("search=atl&location_id={$ship->id}&sort=location&dir=asc"), 'filters compose with the location join');
        $this->assertSame(['P4-AR Rifle'], $names('system=Stanton&sort=system&dir=asc'), 'system filter + sort');
    }
}
