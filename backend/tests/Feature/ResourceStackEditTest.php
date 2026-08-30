<?php

namespace Tests\Feature;

use App\Models\Location;
use App\Models\ResourceStack;
use App\Models\ResourceType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ResourceStackEditTest extends TestCase
{
    use RefreshDatabase;

    private function stack(User $me): ResourceStack
    {
        $type = ResourceType::create(['name' => 'Titanium', 'category' => 'refined', 'unit' => 'mscu']);
        $loc = Location::create(['name' => 'Area18', 'kind' => 'landing_zone', 'system' => 'Stanton', 'user_id' => $me->id]);

        return ResourceStack::create([
            'user_id' => $me->id, 'location_id' => $loc->id, 'resource_type_id' => $type->id,
            'quality' => 500, 'quantity' => 1000, 'visibility' => 'private',
        ]);
    }

    public function test_owner_can_delete_own_stack(): void
    {
        $me = User::factory()->create(['discord_id' => '1', 'handle' => 'me']);
        Sanctum::actingAs($me);
        $stack = $this->stack($me);

        $this->deleteJson("/api/resource-stacks/{$stack->id}")->assertNoContent();
        $this->assertDatabaseMissing('resource_stacks', ['id' => $stack->id]);
    }

    public function test_owner_can_edit_own_stack_and_zero_deletes(): void
    {
        $me = User::factory()->create(['discord_id' => '1', 'handle' => 'me']);
        Sanctum::actingAs($me);
        $stack = $this->stack($me);

        $this->patchJson("/api/resource-stacks/{$stack->id}", [
            'quality' => 600, 'quantity_mscu' => 2000, 'location_id' => $stack->location_id, 'visibility' => 'org',
        ])->assertOk()->assertJsonPath('quantity_mscu', 2000)->assertJsonPath('visibility', 'org');

        $this->patchJson("/api/resource-stacks/{$stack->id}", ['quantity_mscu' => 0])->assertNoContent();
        $this->assertDatabaseMissing('resource_stacks', ['id' => $stack->id]);
    }
}
