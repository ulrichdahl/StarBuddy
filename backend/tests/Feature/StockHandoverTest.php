<?php

namespace Tests\Feature;

use App\Models\ItemStack;
use App\Models\Location;
use App\Models\Org;
use App\Models\ResourceStack;
use App\Models\StockTransfer;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Doing one thing to a whole hold: moving it, or handing it to someone.
 *
 * The stacks move (or leave, when the buyer has no account), so the ledger row
 * is the only record the handover happened — and it has to survive whatever
 * becomes of the stack afterwards.
 */
class StockHandoverTest extends TestCase
{
    use RefreshDatabase;

    private User $me;

    private User $mate;

    private int $levski;

    private int $hangar;

    private int $iron;

    protected function setUp(): void
    {
        parent::setUp();
        $org = Org::create(['name' => 'Stellar Forge']);
        $this->me = User::factory()->create(['discord_id' => '1', 'handle' => 'DK-Raven']);
        $this->mate = User::factory()->create(['discord_id' => '2', 'handle' => 'DK-Ulrich']);
        foreach ([$this->me, $this->mate] as $user) {
            $org->memberships()->attach($user->id, ['role' => 'member', 'status' => 'active']);
        }

        $this->iron = DB::table('resource_types')->insertGetId([
            'name' => 'Iron', 'category' => 'refined', 'unit' => 'mscu',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->levski = Location::create(['kind' => 'station', 'system' => 'Nyx', 'name' => 'Levski'])->id;
        $this->hangar = Location::create(['kind' => 'station', 'system' => 'Stanton', 'name' => 'Area18'])->id;
    }

    private function stack(?User $owner = null, string $visibility = 'org'): ResourceStack
    {
        return ResourceStack::create([
            'user_id' => ($owner ?? $this->me)->id,
            'location_id' => $this->levski,
            'resource_type_id' => $this->iron,
            'quality' => 783,
            'quantity' => 2000,
            'visibility' => $visibility,
            'source' => 'manual',
        ]);
    }

    public function test_a_whole_hold_moves_in_one_go(): void
    {
        $stacks = collect([$this->stack(), $this->stack()]);

        $this->actingAs($this->me)
            ->postJson('/api/stock-transfers/move', [
                'stock' => 'material',
                'stacks' => $stacks->map(fn ($s) => ['id' => $s->id])->all(),
                'location_id' => $this->hangar,
            ])
            ->assertOk()
            ->assertJsonPath('moved', 2);

        $stacks->each(fn ($s) => $this->assertSame($this->hangar, $s->fresh()->location_id));
        // Moving is not a handover, so the ledger stays empty.
        $this->assertSame(0, StockTransfer::count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'stock.moved']);
    }

    public function test_a_whole_hold_is_shared_with_the_org_at_once(): void
    {
        $stacks = collect([$this->stack(visibility: 'private'), $this->stack(visibility: 'private')]);

        $this->actingAs($this->me)
            ->postJson('/api/stock-transfers/visibility', [
                'stock' => 'material',
                'stacks' => $stacks->map(fn ($s) => ['id' => $s->id])->all(),
                'visibility' => 'org',
            ])
            ->assertOk()
            ->assertJsonPath('changed', 2);

        $stacks->each(function ($stack) {
            $stack->refresh();
            $this->assertSame('org', $stack->visibility);
            // Sharing with an org means saying which one.
            $this->assertNotNull($stack->org_id);
        });

        // And back again, which has to let the org go with it.
        $this->actingAs($this->me)
            ->postJson('/api/stock-transfers/visibility', [
                'stock' => 'material',
                'stacks' => $stacks->map(fn ($s) => ['id' => $s->id])->all(),
                'visibility' => 'private',
            ])
            ->assertOk();

        $this->assertSame('private', $stacks->first()->fresh()->visibility);
        $this->assertNull($stacks->first()->fresh()->org_id);
    }

    public function test_an_org_mates_stock_cannot_be_reshared(): void
    {
        $theirs = $this->stack($this->mate, 'org');

        $this->actingAs($this->me)
            ->postJson('/api/stock-transfers/visibility', [
                'stock' => 'material',
                'stacks' => [['id' => $theirs->id]],
                'visibility' => 'private',
            ])
            ->assertStatus(422);

        $this->assertSame('org', $theirs->fresh()->visibility);
    }

    public function test_giving_a_hold_to_an_org_mate_moves_it_to_them(): void
    {
        $stack = $this->stack();

        $this->actingAs($this->me)
            ->postJson('/api/stock-transfers', [
                'stock' => 'material',
                'stacks' => [['id' => $stack->id]],
                'to_handle' => 'dk-ulrich',
                // Zero is how a gift is recorded: the stock still left, and
                // for a price, which happened to be nothing.
                'price' => 0,
            ])
            ->assertOk()
            ->assertJsonPath('price', 0)
            ->assertJsonPath('direction', 'out')
            ->assertJsonPath('known_player', true)
            // The handle as StarBuddy spells it, not as it was typed.
            ->assertJsonPath('counterparty', 'DK-Ulrich');

        $stack->refresh();
        $this->assertSame($this->mate->id, $stack->user_id, 'it is theirs now');
        $this->assertSame($this->levski, $stack->location_id, 'and still where it was');
        $this->assertSame('private', $stack->visibility, 'sharing is the new owner\'s to decide');
    }

    public function test_selling_to_someone_with_no_account_takes_the_stock_off_the_books(): void
    {
        $stack = $this->stack();

        $this->actingAs($this->me)
            ->postJson('/api/stock-transfers', [
                'stock' => 'material',
                'stacks' => [['id' => $stack->id]],
                'to_handle' => 'SomeGuyFromChat',
                'price' => 450000,
                'note' => 'Met at Everus',
            ])
            ->assertOk()
            ->assertJsonPath('stock', 'material')
            ->assertJsonPath('known_player', false)
            ->assertJsonPath('price', 450000);

        $this->assertNull($stack->fresh(), 'the stack is gone');

        // The ledger is all that is left of it, so it has to say what went.
        $sale = StockTransfer::sole();
        $this->assertSame('SomeGuyFromChat', $sale->to_handle);
        $this->assertSame('Iron', $sale->lines[0]['name']);
        $this->assertSame(2000, $sale->lines[0]['quantity']);
        $this->assertSame(783, $sale->lines[0]['quality']);
    }

    public function test_part_of_a_load_can_be_flown_on_and_the_rest_left(): void
    {
        $stack = $this->stack();

        $this->actingAs($this->me)
            ->postJson('/api/stock-transfers/move', [
                'stock' => 'material',
                'stacks' => [['id' => $stack->id, 'quantity' => 500]],
                'location_id' => $this->hangar,
            ])
            ->assertOk();

        // The original keeps its id — a craft or an order may point at it —
        // and the part that flew on is a stack of its own.
        $this->assertSame(1500, $stack->fresh()->quantity);
        $this->assertSame($this->levski, $stack->fresh()->location_id);

        $moved = ResourceStack::where('location_id', $this->hangar)->sole();
        $this->assertSame(500, $moved->quantity);
        $this->assertSame(783, $moved->quality);
        $this->assertSame($this->me->id, $moved->user_id);
    }

    public function test_half_a_load_can_be_sold_and_the_rest_kept(): void
    {
        $stack = $this->stack();

        $this->actingAs($this->me)
            ->postJson('/api/stock-transfers', [
                'stock' => 'material',
                'stacks' => [['id' => $stack->id, 'quantity' => 800]],
                'to_handle' => 'DK-Ulrich',
                'price' => 90000,
            ])
            ->assertOk()
            // The ledger records what went, not what was held.
            ->assertJsonPath('lines.0.quantity', 800);

        $this->assertSame(1200, $stack->fresh()->quantity, 'the rest is still mine');

        $theirs = ResourceStack::where('user_id', $this->mate->id)->sole();
        $this->assertSame(800, $theirs->quantity);
        $this->assertSame('private', $theirs->visibility);
    }

    public function test_asking_for_more_than_there_is_takes_what_there_is(): void
    {
        $stack = $this->stack();

        $this->actingAs($this->me)
            ->postJson('/api/stock-transfers', [
                'stock' => 'material',
                'stacks' => [['id' => $stack->id, 'quantity' => 999999]],
                'to_handle' => 'SomeGuy',
                'price' => 10,
            ])
            ->assertOk()
            ->assertJsonPath('lines.0.quantity', 2000);

        $this->assertNull($stack->fresh(), 'the whole stack went');
    }

    public function test_an_org_mates_stock_cannot_be_handed_over(): void
    {
        $theirs = $this->stack($this->mate);

        // Visible so it can be counted, not spent.
        $this->actingAs($this->me)
            ->postJson('/api/stock-transfers', [
                'stock' => 'material',
                'stacks' => [['id' => $theirs->id]],
                'to_handle' => 'SomeGuy',
                'price' => 1,
            ])
            ->assertStatus(422);

        $this->assertSame($this->mate->id, $theirs->fresh()->user_id);
        $this->assertSame(0, StockTransfer::count());
    }

    public function test_the_ledger_shows_both_ends_of_a_handover(): void
    {
        $this->actingAs($this->me)
            ->postJson('/api/stock-transfers', [
                'stock' => 'material',
                'stacks' => [['id' => $this->stack()->id]],
                'to_handle' => 'DK-Ulrich',
                'price' => 120000,
            ])
            ->assertOk();

        $this->actingAs($this->me)
            ->getJson('/api/stock-transfers')
            ->assertOk()
            ->assertJsonPath('data.0.direction', 'out')
            ->assertJsonPath('data.0.counterparty', 'DK-Ulrich')
            ->assertJsonPath('sold_total', 120000);

        // The same row read from the other end.
        $this->actingAs($this->mate)
            ->getJson('/api/stock-transfers')
            ->assertOk()
            ->assertJsonPath('data.0.direction', 'in')
            ->assertJsonPath('data.0.counterparty', 'DK-Raven')
            ->assertJsonPath('sold_total', 0);
    }

    public function test_items_hand_over_the_same_way_materials_do(): void
    {
        $item = ItemStack::create([
            'user_id' => $this->me->id,
            'location_id' => $this->levski,
            'item_class' => 'behr_rifle_ballistic_01',
            'item_name' => 'P4-AR Rifle',
            'quality' => 910,
            'quantity' => 3,
            'visibility' => 'org',
            'source' => 'manual',
        ]);

        $this->actingAs($this->me)
            ->postJson('/api/stock-transfers', [
                'stock' => 'item',
                'stacks' => [['id' => $item->id]],
                'to_handle' => 'DK-Ulrich',
                'price' => 90000,
            ])
            ->assertOk()
            ->assertJsonPath('stock', 'item')
            ->assertJsonPath('lines.0.name', 'P4-AR Rifle');

        $this->assertSame($this->mate->id, $item->fresh()->user_id);

        // Each list keeps to its own kind, so the materials ledger is empty.
        $this->actingAs($this->me)
            ->getJson('/api/stock-transfers?stock=material')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_the_list_can_be_narrowed_to_your_own_stock(): void
    {
        $this->stack();
        $this->stack($this->mate);

        $this->actingAs($this->me)
            ->getJson('/api/resource-stacks')
            ->assertOk()
            ->assertJsonCount(2, 'data');

        $this->actingAs($this->me)
            ->getJson('/api/resource-stacks?mine=1')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.user_id', $this->me->id);

        // Items narrow the same way.
        foreach ([$this->me, $this->mate] as $owner) {
            ItemStack::create([
                'user_id' => $owner->id, 'location_id' => $this->levski,
                'item_class' => 'behr_rifle_ballistic_01', 'quantity' => 1,
                'visibility' => 'org', 'source' => 'manual',
            ]);
        }

        $this->actingAs($this->me)->getJson('/api/item-stacks')->assertOk()->assertJsonCount(2, 'data');
        $this->actingAs($this->me)
            ->getJson('/api/item-stacks?mine=1')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.user_id', $this->me->id);
    }
}
