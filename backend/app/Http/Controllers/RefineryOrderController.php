<?php

namespace App\Http\Controllers;

use App\Models\Location;
use App\Models\RefineryOrder;
use App\Models\ResourceStack;
use App\Models\ResourceType;
use App\Support\RefineryYield;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Refinery work orders.
 *
 * An order is recorded when the desktop client reads it off a refinement
 * terminal, or typed by hand. From that moment its yields exist as resource
 * stacks marked as refining and sitting at the refinery, so the materials show
 * in the lists while the job runs instead of appearing from nowhere at the end.
 * Collecting the order moves those stacks to wherever the player puts them.
 */
class RefineryOrderController extends Controller
{
    public function index(Request $request)
    {
        $dir = $request->query('dir') === 'asc' ? 'asc' : 'desc';
        $sort = $request->query('sort');
        $column = in_array($sort, ['station', 'method', 'completed_at', 'eta', 'source', 'collected_at'], true)
            ? $sort
            : 'placed_at';

        $orders = RefineryOrder::where('user_id', $request->user()->id)
            ->with(['location', 'collectedLocation'])
            // "Open" is the working list: recorded and not yet collected.
            ->when($request->query('open'), fn ($q) => $q->whereNull('collected_at'))
            ->orderBy($column, $dir)
            ->paginate($this->perPage($request))
            ->appends($request->query());

        $orders->getCollection()->transform(fn ($order) => $this->present($order));

        return $orders;
    }

    public function show(Request $request, RefineryOrder $refineryOrder)
    {
        abort_unless($refineryOrder->user_id === $request->user()->id, 403, 'That order is not yours.');

        return $this->present($refineryOrder->load(['location', 'collectedLocation', 'stacks.resourceType']), true);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'station' => ['required', 'string', 'max:255'],
            'method' => ['nullable', 'string', 'max:255'],
            'work_order_number' => ['nullable', 'integer', 'min:0'],
            'state' => ['nullable', 'in:setup,processing,completed'],
            'materials' => ['nullable', 'array'],
            'materials.*.resource' => ['required_with:materials', 'string', 'max:120'],
            'materials.*.quality' => ['nullable', 'numeric', 'min:0', 'max:1000'],
            'materials.*.yield_amount' => ['nullable', 'numeric', 'min:0'],
            'materials.*.qty' => ['nullable', 'numeric', 'min:0'],
            'materials.*.refine' => ['nullable', 'boolean'],
            'unit' => ['nullable', 'in:SCU,cSCU,mSCU'],
            'duration_seconds' => ['nullable', 'integer', 'min:0'],
            'cost' => ['nullable', 'numeric', 'min:0'],
            'yield_total' => ['nullable', 'numeric', 'min:0'],
            'capture' => ['nullable', 'array'],
            'placed_at' => ['nullable', 'date'],
            'eta' => ['nullable', 'date'],
            // How the order reached StarBuddy, which is worth knowing when its
            // numbers look wrong: a read order is the one to check.
            'source' => ['nullable', 'in:manual,ocr,log'],
        ]);

        $user = $request->user();
        $data['user_id'] = $user->id;
        $data['unit'] ??= 'cSCU';
        $data['source'] ??= 'manual';
        $data['placed_at'] ??= now();
        $data['location_id'] = $this->refineryLocation($request, $data['station'])->id;

        $order = DB::transaction(function () use ($data, $user) {
            $order = RefineryOrder::create($data);
            $this->openStacks($order, $user);

            return $order;
        });

        return response()->json($this->present($order->fresh(['location', 'stacks.resourceType']), true), 201);
    }

    /**
     * Collect a finished order: the materials leave the refinery for wherever
     * the player is putting them.
     *
     * The destination is any location, not just a refinery — collecting often
     * means transferring straight into a ship or a hangar.
     */
    public function collect(Request $request, RefineryOrder $refineryOrder)
    {
        abort_unless($refineryOrder->user_id === $request->user()->id, 403, 'That order is not yours.');
        abort_unless($refineryOrder->isOpen(), 422, 'That order has already been collected.');

        $data = $request->validate([
            'location_id' => ['required', 'exists:locations,id'],
            'collected_at' => ['nullable', 'date'],
        ]);

        DB::transaction(function () use ($refineryOrder, $data) {
            $refineryOrder->update([
                'collected_at' => $data['collected_at'] ?? now(),
                'collected_location_id' => $data['location_id'],
                'completed_at' => $refineryOrder->completed_at ?? ($data['collected_at'] ?? now()),
            ]);
            // The stacks keep their link to the order as provenance; what
            // changes is where they are, and that they are no longer refining.
            $refineryOrder->stacks()->update(['location_id' => $data['location_id']]);
        });

        return $this->present(
            $refineryOrder->fresh(['location', 'collectedLocation', 'stacks.resourceType']),
            true,
        );
    }

    /**
     * The refinery as a place. Refineries are stations the player returns to,
     * so one is kept per name rather than created per order.
     */
    private function refineryLocation(Request $request, string $station): Location
    {
        $user = $request->user();
        $orgId = $user->orgs()->value('orgs.id');

        $existing = Location::where('kind', 'refinery')
            ->whereRaw('LOWER(name) = ?', [strtolower($station)])
            ->where(function ($q) use ($user, $orgId) {
                $q->where('user_id', $user->id)
                    ->orWhere(fn ($q) => $q->whereNotNull('org_id')->where('org_id', $orgId))
                    ->orWhere(fn ($q) => $q->whereNull('user_id')->whereNull('org_id'));
            })
            ->first();

        return $existing ?? Location::create([
            'user_id' => $user->id,
            'org_id' => $orgId,
            'kind' => 'refinery',
            'name' => $station,
        ]);
    }

    /**
     * Create the stacks an order is producing.
     *
     * Only rows the terminal is actually refining count: a row with no yield is
     * one whose REFINE switch is off, and inert material yields nothing at all.
     * A material the catalogue does not know is left on the order rather than
     * silently dropped — the order is still worth recording, and `unmatched`
     * says what could not be placed.
     */
    private function openStacks(RefineryOrder $order, $user): void
    {
        $orgId = $user->orgs()->value('orgs.id');

        foreach ($order->materials ?? [] as $material) {
            $amount = (float) ($material['yield_amount'] ?? 0);
            if ($amount <= 0 || ($material['refine'] ?? true) === false) {
                continue;
            }
            $type = RefineryYield::resolveType((string) ($material['resource'] ?? ''));
            if (! $type instanceof ResourceType) {
                continue;
            }
            $quantity = RefineryYield::toStackQuantity($amount, $order->unit, $type);
            if ($quantity === null) {
                continue;
            }

            ResourceStack::create([
                'user_id' => $user->id,
                'org_id' => $orgId,
                'location_id' => $order->location_id,
                'resource_type_id' => $type->id,
                'quality' => (int) round((float) ($material['quality'] ?? 0)),
                'quantity' => $quantity,
                'visibility' => 'private',
                'source' => $order->source === 'ocr' ? 'ocr' : 'manual',
                'refinery_order_id' => $order->id,
            ]);
        }
    }

    /** @return array<string, mixed> */
    private function present(RefineryOrder $order, bool $full = false): array
    {
        $payload = [
            'id' => $order->id,
            'station' => $order->station,
            'location' => $order->location,
            'method' => $order->method,
            'work_order_number' => $order->work_order_number,
            'state' => $order->state,
            'materials' => $order->materials ?? [],
            'unit' => $order->unit,
            'duration_seconds' => $order->duration_seconds,
            'cost' => $order->cost,
            'yield_total' => $order->yield_total,
            'placed_at' => $order->placed_at?->toIso8601String(),
            'eta' => $order->eta?->toIso8601String(),
            'completed_at' => $order->completed_at?->toIso8601String(),
            'collected_at' => $order->collected_at?->toIso8601String(),
            'collected_location' => $order->collectedLocation,
            'source' => $order->source,
            // Whether the refinery is still holding it, which is what the list
            // sorts and filters on.
            'open' => $order->isOpen(),
        ];

        if ($full) {
            $payload['capture'] = $order->capture;
            $payload['stacks'] = $order->stacks->map(fn ($stack) => [
                'id' => $stack->id,
                'resource' => $stack->resourceType?->name,
                'quality' => $stack->quality,
                'quantity' => $stack->quantity,
                'unit' => $stack->resourceType?->unit,
            ])->all();
            // Materials the catalogue has no entry for, so the modal can say so
            // rather than leaving the player wondering where they went.
            $placed = $order->stacks->map(fn ($s) => strtolower((string) $s->resourceType?->name))->all();
            $payload['unmatched'] = collect($order->materials ?? [])
                ->filter(fn ($m) => (float) ($m['yield_amount'] ?? 0) > 0)
                ->reject(function ($m) use ($placed) {
                    $type = RefineryYield::resolveType((string) ($m['resource'] ?? ''));

                    return $type && in_array(strtolower($type->name), $placed, true);
                })
                ->pluck('resource')
                ->values()
                ->all();
        }

        return $payload;
    }
}
