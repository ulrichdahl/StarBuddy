<?php

namespace Tests\Feature;

use App\Models\ItemStack;
use App\Models\Location;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Crafted and bought gear carries a quality; plain items leave it null. */
class ItemStackQualityTest extends TestCase
{
    use RefreshDatabase;

    public function test_quality_round_trips_and_sorts(): void
    {
        $me = User::factory()->create(['discord_id' => '1', 'handle' => 'me']);
        Sanctum::actingAs($me);
        $loc = Location::create(['name' => 'Area18', 'kind' => 'landing_zone', 'system' => 'Stanton', 'user_id' => $me->id]);

        $this->postJson('/api/item-stacks', [
            'item_class' => 'weapon_ballistic_smg', 'item_name' => 'Karna', 'quality' => 812,
            'quantity' => 2, 'location_id' => $loc->id, 'visibility' => 'private',
        ])->assertCreated()->assertJsonPath('quality', 812);

        $plain = $this->postJson('/api/item-stacks', [
            'item_class' => 'medpen', 'quantity' => 5, 'location_id' => $loc->id, 'visibility' => 'private',
        ])->assertCreated()->assertJsonPath('quality', null)->json('id');

        $this->patchJson("/api/item-stacks/{$plain}", ['quality' => 640])->assertOk()->assertJsonPath('quality', 640);
        $this->patchJson("/api/item-stacks/{$plain}", ['quality' => null])->assertOk()->assertJsonPath('quality', null);
        $this->patchJson("/api/item-stacks/{$plain}", ['quality' => 1200])->assertStatus(422);

        ItemStack::where('id', $plain)->update(['quality' => 100]);
        $rows = $this->getJson('/api/item-stacks?sort=quality&dir=desc')->assertOk()->json('data');
        $this->assertSame([812, 100], array_column($rows, 'quality'));
    }
}
