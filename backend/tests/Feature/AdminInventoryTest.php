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

    public function test_the_main_org_is_cleared_not_the_first(): void
    {
        // The outsider is a manager of Stellar Forge too, but their main org is Other Org.
        $forge = Org::where('name', 'Stellar Forge')->first();
        $forge->memberships()->attach($this->outsider->id, ['role' => 'manager', 'status' => 'active']);
        $this->outsider->forceFill(['main_org_id' => Org::where('name', 'Other Org')->value('id')])->save();

        // A plain member of their main org: refused, even though they manage the first org.
        $this->actingAs($this->outsider)->deleteJson('/api/admin/inventory', ['category' => 'ore'])->assertForbidden();
        $this->assertSame(4, ResourceStack::count());
    }

    public function test_a_player_without_an_org_is_told_so(): void
    {
        $solo = User::factory()->create(['discord_id' => '4']);
        $this->actingAs($solo)->deleteJson('/api/admin/inventory', ['everything' => true])
            ->assertStatus(422)
            ->assertJsonPath('code', 'no_org');
    }

    public function test_anyone_can_clear_their_own_stock_private_included(): void
    {
        $this->actingAs($this->member)
            ->deleteJson('/api/me/inventory', ['everything' => true])
            ->assertOk()
            ->assertJsonPath('cleared.resource_stacks', 2)
            ->assertJsonPath('cleared.item_stacks', 1);

        $this->assertSame(0, ResourceStack::where('user_id', $this->member->id)->count());
        $this->assertSame(2, ResourceStack::count(), 'the manager\'s and the outsider\'s stacks kept');
        $this->assertDatabaseHas('audit_logs', ['action' => 'inventory.own_wipe', 'user_id' => $this->member->id]);
    }

    public function test_own_clear_by_category_and_without_org(): void
    {
        $solo = User::factory()->create(['discord_id' => '4']);
        $this->actingAs($solo)->deleteJson('/api/me/inventory', ['category' => 'ore'])
            ->assertOk()
            ->assertJsonPath('cleared.resource_stacks', 0);

        $this->actingAs($this->member)->deleteJson('/api/me/inventory', ['category' => 'gem'])
            ->assertOk()
            ->assertJsonPath('cleared.resource_stacks', 1);
        $this->assertSame(1, ResourceStack::where('user_id', $this->member->id)->count(), 'private ore kept');
        $this->actingAs($this->member)->deleteJson('/api/me/inventory', [])->assertStatus(422);
    }
}
