<?php

namespace Tests\Feature;

use App\Models\RefineryOrder;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

// Every list honours per_page (clamped 10–200) and sort/dir.
class ListPagingTest extends TestCase
{
    use RefreshDatabase;

    public function test_refinery_orders_page_size_and_sort(): void
    {
        $me = User::factory()->create(['discord_id' => '1']);
        Sanctum::actingAs($me);
        foreach (['Zeta', 'Alpha', 'Mid'] as $i => $station) {
            RefineryOrder::create(['user_id' => $me->id, 'station' => $station, 'source' => 'manual', 'placed_at' => now()->subDays($i)]);
        }

        $res = $this->getJson('/api/refinery-orders?per_page=5&sort=station&dir=asc')->assertOk()->json();
        $this->assertSame(10, $res['per_page'], 'below the floor clamps to 10');
        $this->assertSame(['Alpha', 'Mid', 'Zeta'], array_column($res['data'], 'station'));

        $res = $this->getJson('/api/refinery-orders?per_page=999')->assertOk()->json();
        $this->assertSame(200, $res['per_page'], 'above the ceiling clamps to 200');
        $this->assertSame(['Zeta', 'Alpha', 'Mid'], array_column($res['data'], 'station'), 'default: newest placed first');
    }
}
