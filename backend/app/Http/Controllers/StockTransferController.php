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
    /** The stacks named by the request that actually belong to the caller. */
    private function stacks(Request $request): array
    {
        $data = $request->validate([
            'stock' => ['required', 'in:material,item'],
            'stack_ids' => ['required', 'array', 'min:1', 'max:500'],
            'stack_ids.*' => ['integer'],
        ]);

        $stacks = $data['stock'] === 'item'
            ? ItemStack::with('location')->whereIn('id', $data['stack_ids'])
                ->where('user_id', $request->user()->id)->get()
            : ResourceStack::with(['resourceType', 'location'])->whereIn('id', $data['stack_ids'])
                ->where('user_id', $request->user()->id)->get();

        abort_if($stacks->isEmpty(), 422, 'None of those stacks are yours.');

        return [$data['stock'], $stacks];
    }

    /** What the stacks were, for a record that must outlive them. */
    private function snapshot(string $stock, Collection $stacks): array
    {
        return $stacks->map(fn (Model $s) => $stock === 'item'
            ? [
                'item_class' => $s->item_class,
                'name' => $s->item_name ?? $s->item_class,
                'quality' => $s->quality,
                'quantity' => $s->quantity,
                'unit' => 'pieces',
                'location' => $s->location?->name,
            ]
            : [
                'resource_type_id' => $s->resource_type_id,
                'name' => $s->resourceType?->name,
                'category' => $s->resourceType?->category,
                'unit' => $s->resourceType?->unit,
                'quality' => $s->quality,
                'quantity' => $s->quantity,
                'location' => $s->location?->name,
            ])->values()->all();
    }

    /**
     * Move a hold to another place.
     *
     * Nothing changes hands, so there is no ledger entry — the audit log is
     * enough to answer "where did that go" later.
     */
    public function move(Request $request)
    {
        [$stock, $stacks] = $this->stacks($request);
        $data = $request->validate(['location_id' => ['required', 'exists:locations,id']]);

        DB::transaction(function () use ($stock, $stacks, $data, $request) {
            $this->query($stock)->whereIn('id', $stacks->pluck('id'))
                ->update($this->touched($stock, ['location_id' => $data['location_id']], $request->user()->id));

            AuditLog::create([
                'user_id' => $request->user()->id,
                'org_id' => $request->user()->orgs()->value('orgs.id'),
                'action' => 'stock.moved',
                'details' => [
                    'stock' => $stock,
                    'location_id' => $data['location_id'],
                    'lines' => $this->snapshot($stock, $stacks),
                ],
            ]);
        });

        return ['moved' => $stacks->count()];
    }

    /**
     * Hand a hold to another player for a price.
     *
     * Zero is a real price and the way a gift is recorded: what matters is
     * that the stock left, and for how much.
     */
    public function hand(Request $request)
    {
        [$stock, $stacks] = $this->stacks($request);
        $data = $request->validate([
            'to_handle' => ['required', 'string', 'max:120'],
            'price' => ['required', 'numeric', 'min:0', 'max:99999999999'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);

        $me = $request->user();
        $recipient = $this->findPlayer($data['to_handle']);
        abort_if($recipient?->id === $me->id, 422, 'That is you.');

        $transfer = DB::transaction(function () use ($stock, $stacks, $data, $me, $recipient) {
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
                'location_id' => $stacks->first()->location_id,
                'lines' => $this->snapshot($stock, $stacks),
                'note' => $data['note'] ?? null,
            ]);

            $ids = $stacks->pluck('id');
            if ($recipient === null) {
                // Nobody to hand them to: the stock left the 'verse as far as
                // StarBuddy is concerned.
                $this->query($stock)->whereIn('id', $ids)->delete();
            } else {
                // They keep where they are and what they are worth; what
                // changes is whose they are. Visibility drops to private:
                // sharing is the new owner's to decide, not the old one's.
                $this->query($stock)->whereIn('id', $ids)->update($this->touched($stock, [
                    'user_id' => $recipient->id,
                    'org_id' => $recipient->orgs()->value('orgs.id'),
                    'visibility' => 'private',
                ], $recipient->id));
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
