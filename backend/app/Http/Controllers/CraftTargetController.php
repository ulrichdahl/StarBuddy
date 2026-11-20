<?php

namespace App\Http\Controllers;

use App\Models\Blueprint;
use App\Models\CraftTarget;
use App\Models\ResourceStack;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * Blueprints a player has pinned to craft.
 *
 * GET returns the targets and, summed across them, the materials still to
 * gather: what the recipes need times how many of each, against what the
 * player holds themselves and what the org has on offer. That list is what
 * the desktop client's Gathering view shows.
 */
class CraftTargetController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        $targets = CraftTarget::where('user_id', $user->id)
            ->with('blueprint:id,name,item_class,ingredients')
            ->orderBy('created_at')
            ->get();

        $need = [];
        foreach ($targets as $target) {
            foreach ($target->blueprint->ingredients ?? [] as $ing) {
                $unit = isset($ing['quantity_mscu']) ? 'mscu' : 'pieces';
                $per = (int) ($ing['quantity_mscu'] ?? $ing['quantity_pieces'] ?? 0);
                $key = mb_strtolower($ing['name']).'|'.$unit;
                $need[$key] ??= ['name' => $ing['name'], 'unit' => $unit, 'need' => 0, 'for' => []];
                $need[$key]['need'] += $per * $target->quantity;
                $need[$key]['for'][] = $target->blueprint_id;
            }
        }

        $gathering = collect($need)->map(function (array $row) use ($user) {
            $mine = $this->held(ResourceStack::where('user_id', $user->id), $row);
            $org = $this->held(ResourceStack::visibleTo($user), $row);

            return [
                ...$row,
                'for' => array_values(array_unique($row['for'])),
                'have_mine' => $mine,
                'have_org' => $org,
                // What is left to find once the player's own stock is used.
                'missing' => max(0, $row['need'] - $mine),
            ];
        })->sortBy([['missing', 'desc'], ['name', 'asc']])->values();

        return [
            'targets' => $targets->map(fn (CraftTarget $t) => [
                'blueprint_id' => $t->blueprint_id,
                'name' => $t->blueprint->name,
                'item_class' => $t->blueprint->item_class,
                'quantity' => $t->quantity,
                'pinned_at' => $t->created_at?->toIso8601String(),
            ]),
            'gathering' => $gathering,
        ];
    }

    /** Pin a blueprint, or change how many of it. */
    public function store(Request $request)
    {
        $data = $request->validate([
            'blueprint_id' => ['required', 'integer', 'exists:blueprints,id'],
            'quantity' => ['nullable', 'integer', 'min:1', 'max:999'],
        ]);
        $target = CraftTarget::updateOrCreate(
            ['user_id' => $request->user()->id, 'blueprint_id' => $data['blueprint_id']],
            ['quantity' => $data['quantity'] ?? 1],
        );

        return response()->json([
            'blueprint_id' => $target->blueprint_id,
            'quantity' => $target->quantity,
        ], $target->wasRecentlyCreated ? 201 : 200);
    }

    public function destroy(Request $request, Blueprint $blueprint)
    {
        CraftTarget::where('user_id', $request->user()->id)->where('blueprint_id', $blueprint->id)->delete();

        return response()->noContent();
    }

    /** Quantity of one material in a set of stacks, usable quality only. */
    private function held($stacks, array $row): int
    {
        return (int) $stacks
            ->whereHas('resourceType', fn ($q) => $q->whereLike('name', $row['name'], caseSensitive: false))
            ->when($row['unit'] === 'mscu', fn ($q) => $q->where('quality', '>=', 1))
            ->sum('quantity');
    }
}
