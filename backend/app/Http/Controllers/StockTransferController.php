<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\ItemStack;
use App\Models\ResourceStack;
use App\Models\StockTransfer;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Doing something to a hold at once: moving it, or handing it to someone.
 *
 * A player who has just flown a load somewhere has twenty stacks to correct,
 * and correcting them one at a time is the reason inventories go stale. Every
 * action here takes the stacks the player picked and does one thing to all of
 * them, materials or items alike.
 *
 * Only the caller's own stacks can be touched, whatever the request says: an
 * org mate's stock is visible so it can be counted, not spent.
 */
class StockTransferController extends Controller
{
    /**
     * The stacks named by the request that actually belong to the caller, each
     * with how much of it is being acted on.
     *
     * A hold is not always handed over whole — half a load sold, the rest kept
     * — so every stack carries a `take`. Omitted means all of it, and asking
     * for more than there is means all of it too: the stack is the truth about
     * how much exists.
     *
     * @return array{0: string, 1: Collection<int, array{stack: Model, take: int}>}
     */
    private function stacks(Request $request): array
    {
        $data = $request->validate([
            'stock' => ['required', 'in:material,item'],
            'stacks' => ['required', 'array', 'min:1', 'max:500'],
            'stacks.*.id' => ['required', 'integer'],
            'stacks.*.quantity' => ['nullable', 'integer', 'min:1'],
        ]);

        $wanted = collect($data['stacks'])->keyBy('id');

        $rows = $data['stock'] === 'item'
            ? ItemStack::with('location')->whereIn('id', $wanted->keys())
                ->where('user_id', $request->user()->id)->get()
            : ResourceStack::with(['resourceType', 'location'])->whereIn('id', $wanted->keys())
                ->where('user_id', $request->user()->id)->get();

        abort_if($rows->isEmpty(), 422, 'None of those stacks are yours.');

        $picked = $rows->map(fn (Model $stack) => [
            'stack' => $stack,
            'take' => min((int) ($wanted[$stack->id]['quantity'] ?? $stack->quantity), (int) $stack->quantity),
        ])->filter(fn (array $row) => $row['take'] > 0)->values();

        abort_if($picked->isEmpty(), 422, 'Nothing to take from those stacks.');

        return [$data['stock'], $picked];
    }

    /**
     * What went, for a record that must outlive the stacks — the amount taken
     * rather than the amount held, since half a load may have stayed behind.
     */
    private function snapshot(string $stock, Collection $picked): array
    {
        return $picked->map(function (array $row) use ($stock) {
            $s = $row['stack'];

            return $stock === 'item'
                ? [
                    'item_class' => $s->item_class,
                    'name' => $s->item_name ?? $s->item_class,
                    'quality' => $s->quality,
                    'quantity' => $row['take'],
                    'unit' => 'pieces',
                    'location' => $s->location?->name,
                ]
                : [
                    'resource_type_id' => $s->resource_type_id,
                    'name' => $s->resourceType?->name,
                    'category' => $s->resourceType?->category,
                    'unit' => $s->resourceType?->unit,
                    'quality' => $s->quality,
                    'quantity' => $row['take'],
                    'location' => $s->location?->name,
                ];
        })->values()->all();
    }

    /**
     * Take part of a stack off it, as a stack of its own.
     *
     * The remainder keeps the original row — its id is what a craft, an order
     * or an audit entry points at — and the part that left becomes a new row
     * the caller can then place, hand over or drop.
     */
    private function split(Model $stack, int $take, array $changes): Model
    {
        $stack->decrement('quantity', $take);

        $copy = $stack->replicate();
        $copy->quantity = $take;
        // A split is a new holding, not the same one: whatever the original
        // came from, this part is being moved or sold by hand. Only one of
        // these columns exists on either table, so clear what is there.
        foreach (['refinery_order_id', 'craft_id'] as $origin) {
            if (array_key_exists($origin, $copy->getAttributes())) {
                $copy->{$origin} = null;
            }
        }
        $copy->forceFill($changes);
        $copy->save();

        return $copy;
    }

    /**
     * Move a hold to another place.
     *
     * Nothing changes hands, so there is no ledger entry — the audit log is
     * enough to answer "where did that go" later.
     */
    public function move(Request $request)
    {
        [$stock, $picked] = $this->stacks($request);
        $data = $request->validate(['location_id' => ['required', 'exists:locations,id']]);

        DB::transaction(function () use ($stock, $picked, $data, $request) {
            $me = $request->user();
            foreach ($picked as $row) {
                $changes = $this->touched($stock, ['location_id' => $data['location_id']], $me->id);
                if ($row['take'] >= (int) $row['stack']->quantity) {
                    $row['stack']->forceFill($changes)->save();

                    continue;
                }
                // Part of a load flown on: the rest stays where it was.
                $this->split($row['stack'], $row['take'], $changes);
            }

            AuditLog::create([
                'user_id' => $me->id,
                'org_id' => $me->orgs()->value('orgs.id'),
                'action' => 'stock.moved',
                'details' => [
                    'stock' => $stock,
                    'location_id' => $data['location_id'],
                    'lines' => $this->snapshot($stock, $picked),
                ],
            ]);
        });

        return ['moved' => $picked->count()];
    }

    /**
     * Share a hold with the org, or take it back.
     *
     * Visibility is per stack, and a player who has just hauled a load home
     * has the same answer for all of it — so it is worth setting once rather
     * than twenty times.
     */
    public function visibility(Request $request)
    {
        [$stock, $picked] = $this->stacks($request);
        $data = $request->validate(['visibility' => ['required', 'in:private,org']]);

        DB::transaction(function () use ($stock, $picked, $data, $request) {
            $me = $request->user();
            // Whole stacks, whatever amounts were asked for: half a stack
            // shared and half not is two rows of the same thing, which is a
            // worse answer than the question deserves.
            $this->query($stock)->whereIn('id', $picked->pluck('stack.id'))->update($this->touched($stock, [
                'visibility' => $data['visibility'],
                // Sharing with an org you are in means saying which one.
                'org_id' => $data['visibility'] === 'org' ? $me->orgs()->value('orgs.id') : null,
            ], $me->id));

            AuditLog::create([
                'user_id' => $me->id,
                'org_id' => $me->orgs()->value('orgs.id'),
                'action' => 'stock.visibility',
                'details' => [
                    'stock' => $stock,
                    'visibility' => $data['visibility'],
                    'lines' => $this->snapshot($stock, $picked),
                ],
            ]);
        });

        return ['changed' => $picked->count()];
    }

    /**
     * Hand a hold to another player for a price.
     *
     * Zero is a real price and the way a gift is recorded: what matters is
     * that the stock left, and for how much.
     */
    public function hand(Request $request)
    {
        [$stock, $picked] = $this->stacks($request);
        $data = $request->validate([
            'to_handle' => ['required', 'string', 'max:120'],
            'price' => ['required', 'numeric', 'min:0', 'max:99999999999'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);

        $me = $request->user();
        $recipient = $this->findPlayer($data['to_handle']);
        abort_if($recipient?->id === $me->id, 422, 'That is you.');

        $transfer = DB::transaction(function () use ($stock, $picked, $data, $me, $recipient) {
            $transfer = StockTransfer::create([
                'user_id' => $me->id,
                'org_id' => $me->orgs()->value('orgs.id'),
                'stock' => $stock,
                'to_user_id' => $recipient?->id,
                // The handle as typed when nobody matches it, and the real one
                // when somebody does — so a ledger row reads the same however
                // it was spelled on the day.
                'to_handle' => $recipient?->handle ?? $recipient?->name ?? trim($data['to_handle']),
                'price' => $data['price'],
                'location_id' => $picked->first()['stack']->location_id,
                'lines' => $this->snapshot($stock, $picked),
                'note' => $data['note'] ?? null,
            ]);

            // They keep where they are and what they are worth; what changes
            // is whose they are. Visibility drops to private: sharing is the
            // new owner's to decide, not the old one's.
            $handed = $recipient === null ? null : $this->touched($stock, [
                'user_id' => $recipient->id,
                'org_id' => $recipient->orgs()->value('orgs.id'),
                'visibility' => 'private',
            ], $recipient->id);

            foreach ($picked as $row) {
                $whole = $row['take'] >= (int) $row['stack']->quantity;

                if ($handed === null) {
                    // Nobody to hand it to: that much stock left the 'verse as
                    // far as StarBuddy is concerned.
                    $whole ? $row['stack']->delete() : $row['stack']->decrement('quantity', $row['take']);

                    continue;
                }

                $whole
                    ? $row['stack']->forceFill($handed)->save()
                    : $this->split($row['stack'], $row['take'], $handed);
            }

            return $transfer;
        });

        return $this->present($transfer->fresh(['recipient', 'location']), $me);
    }

    private function query(string $stock): Builder
    {
        return $stock === 'item' ? ItemStack::query() : ResourceStack::query();
    }

    /**
     * Item stacks have no `updated_by`; material stacks record who last moved
     * them, and that is worth keeping accurate.
     */
    private function touched(string $stock, array $changes, int $userId): array
    {
        return $stock === 'item' ? $changes : $changes + ['updated_by' => $userId];
    }

    /**
     * A player by handle: an exact handle first, then a Discord name, both
     * case-insensitively. Null when nobody matches, which is a buyer who has
     * never heard of StarBuddy rather than an error.
     */
    private function findPlayer(string $handle): ?User
    {
        $needle = Str::lower(trim($handle));

        return User::whereRaw('LOWER(handle) = ?', [$needle])->first()
            ?? User::whereRaw('LOWER(name) = ?', [$needle])->first()
            ?? User::whereRaw('LOWER(discord_username) = ?', [$needle])->first();
    }

    /**
     * The ledger: what the player handed over, and what was handed to them.
     *
     * Both directions in one list, because "where did that Iron go" and "where
     * did this Iron come from" are the same question asked from either end.
     */
    public function index(Request $request)
    {
        $me = $request->user();
        $stock = $request->query('stock');

        $mine = fn ($q) => $q->where('user_id', $me->id)->orWhere('to_user_id', $me->id);

        $rows = StockTransfer::with(['recipient:id,name,handle', 'user:id,name,handle', 'location'])
            ->where($mine)
            ->when($stock, fn ($q, $s) => $q->where('stock', $s))
            ->orderByDesc('created_at')
            ->paginate($this->perPage($request))
            ->appends($request->query());

        $rows->getCollection()->transform(fn (StockTransfer $t) => $this->present($t, $me));

        return $rows->toArray() + [
            // What the player has taken for stock, all told. The ledger is
            // worth keeping mostly for this one number.
            'sold_total' => (float) StockTransfer::where('user_id', $me->id)
                ->when($stock, fn ($q, $s) => $q->where('stock', $s))
                ->sum('price'),
        ];
    }

    /** @return array<string, mixed> */
    private function present(StockTransfer $transfer, User $me): array
    {
        return [
            'id' => $transfer->id,
            'stock' => $transfer->stock,
            // Which end of it the caller was on.
            'direction' => $transfer->user_id === $me->id ? 'out' : 'in',
            'counterparty' => $transfer->user_id === $me->id
                ? $transfer->to_handle
                : ($transfer->user?->handle ?? $transfer->user?->name),
            'known_player' => $transfer->to_user_id !== null,
            'price' => (float) $transfer->price,
            'location' => $transfer->location,
            'lines' => $transfer->lines ?? [],
            'note' => $transfer->note,
            'created_at' => $transfer->created_at?->toIso8601String(),
        ];
    }
}
