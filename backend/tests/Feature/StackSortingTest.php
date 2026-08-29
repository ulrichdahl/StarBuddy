<?php

namespace Tests\Feature;

use App\Models\Location;
use App\Models\ResourceStack;
use App\Models\ResourceType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Sorting by location joins `locations`, which has its own user_id and
 * visibility-adjacent columns — the visibility scope and filters must stay
 * table-qualified or Postgres rejects the query as ambiguous.
 */
class StackSortingTest extends TestCase
{
    use RefreshDatabase;

    public function test_resource_stacks_sort_by_location_with_filters(): void
    {
        $me = User::factory()->create(['discord_id' => '1', 'handle' => 'me']);
        Sanctum::actingAs($me);
        $type = ResourceType::create(['name' => 'Titanium', 'category' => 'refined', 'unit' => 'mscu']);
        $b = Location::create(['name' => 'Baijini Point', 'kind' => 'station', 'system' => 'Stanton', 'user_id' => $me->id]);
        $a = Location::create(['name' => 'Area18', 'kind' => 'landing_zone', 'system' => 'Stanton', 'user_id' => $me->id]);
        $p = Location::create(['name' => 'Pyro Gateway', 'kind' => 'station', 'system' => 'Pyro', 'user_id' => $me->id]);
        foreach ([$b, $a, $p] as $loc) {
            ResourceStack::create([
                'user_id' => $me->id, 'location_id' => $loc->id, 'resource_type_id' => $type->id,
                'quality' => 500, 'quantity' => 1000, 'visibility' => 'private',
            ]);
        }

        $rows = $this->getJson('/api/resource-stacks?sort=location&dir=asc&visibility=private&quality_min=1&search=tit')
            ->assertOk()->json('data');

        $this->assertSame(['Area18', 'Baijini Point', 'Pyro Gateway'], array_column(array_column($rows, 'location'), 'name'));

        $bySystem = $this->getJson('/api/resource-stacks?sort=system&dir=asc')->assertOk()->json('data');
        $this->assertSame(['Pyro', 'Stanton', 'Stanton'], array_column(array_column($bySystem, 'location'), 'system'));
        $pyro = $this->getJson('/api/resource-stacks?system=Pyro')->assertOk()->json('data');
        $this->assertSame(['Pyro Gateway'], array_column(array_column($pyro, 'location'), 'name'));
    }
}
