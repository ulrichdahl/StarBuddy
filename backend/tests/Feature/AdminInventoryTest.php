<?php

namespace Tests\Feature;

use App\Models\ItemStack;
use App\Models\Org;
use App\Models\ResourceStack;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class AdminInventoryTest extends TestCase
{
    use RefreshDatabase;

    private User $manager;
    private User $member;
    private User $outsider;
    private int $oreId;
    private int $gemId;

    protected function setUp(): void
    {
        parent::setUp();
        $org = Org::create(['name' => 'Stellar Forge']);
        $other = Org::create(['name' => 'Other Org']);
        $this->manager = User::factory()->create(['discord_id' => '1']);
        $this->member = User::factory()->create(['discord_id' => '2']);
        $this->outsider = User::factory()->create(['discord_id' => '3']);
        $org->memberships()->attach($this->manager->id, ['role' => 'manager', 'status' => 'active']);
        $org->memberships()->attach($this->member->id, ['role' => 'member', 'status' => 'active']);
        $other->memberships()->attach($this->outsider->id, ['role' => 'member', 'status' => 'active']);

        $this->oreId = DB::table('resource_types')->insertGetId(['name' => 'Quantainium', 'category' => 'ore', 'unit' => 'mscu', 'created_at' => now(), 'updated_at' => now()]);
        $this->gemId = DB::table('resource_types')->insertGetId(['name' => 'Hadanite', 'category' => 'gem', 'unit' => 'pieces', 'created_at' => now(), 'updated_at' => now()]);
        $loc = DB::table('locations')->insertGetId(['name' => 'Area18 hangar', 'kind' => 'hangar', 'created_at' => now(), 'updated_at' => now()]);

        $stack = fn (User $u, int $type, string $vis) => ResourceStack::create([
            'user_id' => $u->id, 'org_id' => $org->id, 'location_id' => $loc, 'resource_type_id' => $type,
            'quality' => 700, 'quantity' => 1000, 'visibility' => $vis, 'source' => 'manual',
        ]);
        $stack($this->manager, $this->oreId, 'org');
        $stack($this->member, $this->oreId, 'private');
        $stack($this->member, $this->gemId, 'org');
        $stack($this->outsider, $this->oreId, 'org');   // another org — never touched
        ItemStack::create(['user_id' => $this->member->id, 'org_id' => $org->id, 'location_id' => $loc, 'item_class' => 'POWR_X', 'item_name' => 'Power plant', 'quantity' => 1, 'visibility' => 'private', 'source' => 'craft']);
    }

    public function test_category_clear_no_longer_crashes_and_spares_private_stashes(): void
    {
        $this->actingAs($this->manager)
            ->deleteJson('/api/admin/inventory', ['category' => 'ore'])
            ->assertOk()
            ->assertJsonPath('cleared.resource_stacks', 1);   // only the org-visible ore stack

        $this->assertSame(1, ResourceStack::where('resource_type_id', $this->oreId)->where('user_id', $this->member->id)->count(), 'private stash kept');
        $this->assertSame(1, ResourceStack::where('user_id', $this->outsider->id)->count(), 'other org untouched');
    }

    public function test_category_clear_can_include_private(): void
    {
        $this->actingAs($this->manager)
            ->deleteJson('/api/admin/inventory', ['category' => 'ore', 'include_private' => true])
            ->assertOk()
            ->assertJsonPath('cleared.resource_stacks', 2);
        $this->assertSame(1, ResourceStack::where('resource_type_id', $this->gemId)->count(), 'other category kept');
    }

    public function test_game_wipe_clears_all_materials_and_items_of_the_org(): void
    {
        $this->actingAs($this->manager)
            ->deleteJson('/api/admin/inventory', ['everything' => true])
            ->assertOk()
            ->assertJsonPath('cleared.resource_stacks', 3)
            ->assertJsonPath('cleared.item_stacks', 1);

        $this->assertSame(1, ResourceStack::count(), 'only the other org\'s stack remains');
        $this->assertSame(0, ItemStack::count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'inventory.wipe', 'user_id' => $this->manager->id]);
    }

    public function test_patch_reset_can_keep_items_and_limit_categories(): void
    {
        // LTP kept the crafted items and the gems this patch: wipe ore only.
        $this->actingAs($this->manager)
            ->deleteJson('/api/admin/inventory', ['everything' => true, 'resource_categories' => ['ore'], 'items' => false])
            ->assertOk()
            ->assertJsonPath('cleared.resource_stacks', 2)
            ->assertJsonPath('cleared.item_stacks', 0);

        $this->assertSame(1, ResourceStack::where('resource_type_id', $this->gemId)->count(), 'gems kept');
        $this->assertSame(1, ItemStack::count(), 'items kept');
    }

    public function test_plain_members_and_empty_scope_are_refused(): void
    {
        $this->actingAs($this->member)->deleteJson('/api/admin/inventory', ['everything' => true])->assertForbidden();
        $this->actingAs($this->manager)->deleteJson('/api/admin/inventory', [])->assertStatus(422);
        $this->assertSame(4, ResourceStack::count());
    }
}
