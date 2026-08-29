<?php

namespace App\Http\Controllers;

use App\Models\Blueprint;
use App\Models\ItemStack;
use App\Models\ResourceStack;
use App\Support\OrgMembers;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * What the org can draw on: org-visible stacks of every active member,
 * grouped into one row per item (or material + quality) with the total,
 * the number of stacks it sits in, and how much each member holds — the
 * matrix the Items and Materials pages show in Org view.
 */
class OrgInventoryController extends Controller
{
    /** Filters: search (name/class), system, location_id. Sort: name (default), total, stacks, holders. */
    public function items(Request $request)
    {
        $me = $request->user();
        $members = OrgMembers::of($me);

        $stacks = ItemStack::query()
            ->where('visibility', 'org')
            ->whereIn('user_id', $members->pluck('id'))
            ->when($request->query('search'), fn ($q, $s) => $q->where(fn ($q) => $q
                ->whereLike('item_name', "%{$s}%", caseSensitive: false)
                ->orWhereLike('item_class', "%{$s}%", caseSensitive: false)))
            ->when($request->query('system'), fn ($q, $s) => $q->whereHas('location', fn ($l) => $l->where('system', $s)))
            ->when($request->query('location_id'), fn ($q, $id) => $q->where('location_id', $id))
            ->get(['id', 'user_id', 'item_class', 'item_name', 'quantity']);

        $rows = $stacks
            ->groupBy(fn (ItemStack $s) => Blueprint::normalizeClass($s->item_class))
            ->map(function (Collection $group, string $key) {
                // Display name: the most common catalog name, minus the
                // "(Q450)" suffix crafted stacks carry; the class if none.
                $name = $group->pluck('item_name')->filter()
                    ->map(fn ($n) => preg_replace('/\s*\(Q\d+\)$/', '', $n))
                    ->countBy()->sortDesc()->keys()->first() ?? $group->first()->item_class;

                return [
                    'key' => $key,
                    'name' => $name,
                    'item_class' => $group->first()->item_class,
                    'total' => (int) $group->sum('quantity'),
                    'stacks' => $group->count(),
                ] + $this->holders($group);
            })
            ->values();

        return $this->respond($request, $rows, $members, fn (array $r) => Str::lower($r['name']));
    }

    /** Filters: search (material), quality_min/max, system, location_id. Sort: name (default), quality, total, stacks, holders. */
    public function materials(Request $request)
    {
        $me = $request->user();
        $members = OrgMembers::of($me);

        $stacks = ResourceStack::query()
            ->with('resourceType:id,name,category,unit,rarity')
            ->where('visibility', 'org')
            ->whereIn('user_id', $members->pluck('id'))
            ->when($request->query('search'), fn ($q, $s) => $q->whereHas(
                'resourceType', fn ($t) => $t->whereLike('name', "%{$s}%", caseSensitive: false),
            ))
            ->when($request->query('quality_min'), fn ($q, $v) => $q->where('quality', '>=', (int) $v))
            ->when($request->query('quality_max'), fn ($q, $v) => $q->where('quality', '<=', (int) $v))
            ->when($request->query('system'), fn ($q, $s) => $q->whereHas('location', fn ($l) => $l->where('system', $s)))
            ->when($request->query('location_id'), fn ($q, $id) => $q->where('location_id', $id))
            ->get(['id', 'user_id', 'resource_type_id', 'quality', 'quantity']);

        $rows = $stacks
            ->groupBy(fn (ResourceStack $s) => "{$s->resource_type_id}:{$s->quality}")
            ->map(function (Collection $group, string $key) {
                $first = $group->first();

                return [
                    'key' => $key,
                    'resource_type' => $first->resourceType?->only(['id', 'name', 'category', 'unit', 'rarity']),
                    'quality' => $first->quality,
                    'total' => (int) $group->sum('quantity'),
                    'stacks' => $group->count(),
                ] + $this->holders($group);
            })
            ->values();

        return $this->respond(
            $request,
            $rows,
            $members,
            // Same material: highest quality first.
            fn (array $r) => sprintf('%s %04d', Str::lower($r['resource_type']['name'] ?? ''), 9999 - (int) $r['quality']),
            ['quality' => fn (array $r) => (int) $r['quality']],
        );
    }

    /** Per member: how much and in how many stacks. Keyed by user id. */
    private function holders(Collection $group): array
    {
        $holders = $group->groupBy('user_id')->map(fn (Collection $g) => [
            'quantity' => (int) $g->sum('quantity'),
            'stacks' => $g->count(),
        ]);

        return ['holder_count' => $holders->count(), 'holders' => $holders->all()];
    }

    /** Sort, paginate, and attach the member columns. */
    private function respond(Request $request, Collection $rows, Collection $members, callable $nameKey, array $extraSorts = [])
    {
        $sorts = $extraSorts + [
            'name' => $nameKey,
            'total' => fn (array $r) => $r['total'],
            'stacks' => fn (array $r) => $r['stacks'],
            'holders' => fn (array $r) => $r['holder_count'],
        ];
        $key = $sorts[$request->query('sort')] ?? $sorts['name'];
        $rows = $request->query('dir') === 'desc' ? $rows->sortByDesc($key) : $rows->sortBy($key);

        $perPage = $this->perPage($request);
        $page = max(1, (int) $request->query('page', 1));
        $paginator = new LengthAwarePaginator($rows->forPage($page, $perPage)->values(), $rows->count(), $perPage, $page);

        return $paginator->toArray() + [
            'members' => $members->map(fn ($u) => ['id' => $u->id, 'handle' => $u->handle ?? $u->name])->values(),
        ];
    }
}
