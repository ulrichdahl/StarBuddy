<?php

namespace App\Http\Controllers;

use App\Models\Blueprint;
use App\Models\BlueprintOwned;
use App\Models\User;
use App\Support\BlueprintKind;
use App\Support\FabricatorCategory;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Str;

class BlueprintController extends Controller
{
    public function index(Request $request)
    {
        return Blueprint::query()
            ->when($request->query('search'), fn ($q, $s) => $q->whereLike('name', "%{$s}%", caseSensitive: false))
            ->orderBy('name')
            ->limit(50)
            ->get();
    }

    /** Org-mates including the viewer, as the matrix/catalog columns. */
    private function members(User $me)
    {
        return \App\Support\OrgMembers::of($me);
    }

    /**
     * Every blueprint in kiosk order with who owns it — the checklist and
     * the matrix are two views of this. Filters: search, category
     * ("armor" or "armor/helmets"), grade, owned (by anyone in the org, or
     * default), unowned_by_me, unowned (by anyone in the org). Sort: kiosk (default), name, type, grade, owners; dir.
     * Pagination: per_page (10–200), page.
     */
    public function catalog(Request $request)
    {
        $me = $request->user();
        $members = $this->members($me);
        $memberIds = $members->pluck('id');
        $handles = $members->mapWithKeys(fn ($u) => [$u->id => $u->handle ?? $u->name]);

        $owned = BlueprintOwned::whereIn('user_id', $memberIds)
            ->whereNotNull('blueprint_id')
            ->get(['id', 'blueprint_id', 'user_id'])
            ->groupBy('blueprint_id');

        $category = $request->query('category');
        $rows = Blueprint::query()
            ->when($request->query('search'), fn ($q, $s) => $q->whereLike('name', "%{$s}%", caseSensitive: false))
            ->when($request->query('grade'), fn ($q, $g) => $q->where('grade', $g))
            ->orderBy('name')
            ->get()
            ->filter(fn (Blueprint $b) => ! $category || FabricatorCategory::matches($b, $category))
            ->map(function (Blueprint $b) use ($owned, $me, $handles) {
                [$cat, $sub] = FabricatorCategory::of($b);
                $rows = $owned[$b->id] ?? collect();
                $ownerIds = $rows->pluck('user_id')->unique()->values();
                $mine = $rows->firstWhere('user_id', $me->id);
                $others = $ownerIds->reject(fn ($id) => $id === $me->id)->values();

                return [
                    'id' => $b->id,
                    'name' => $b->name,
                    'category' => $cat,
                    'subcategory' => $sub,
                    'category_label' => FabricatorCategory::label($cat, $sub),
                    'type_display' => BlueprintKind::label($b),
                    'grade' => $b->grade,
                    // Size matters for ship parts: components and vehicle weapons.
                    'size' => in_array(BlueprintKind::group($b->type), ['vehicle_components', 'vehicle_weapons'], true)
                        ? ($b->item_meta['size'] ?? null)
                        : null,
                    'is_default' => (bool) $b->is_default,
                    'owned_by_me' => $mine !== null,
                    'my_owned_id' => $mine?->id,
                    'owner_ids' => $ownerIds,
                    'owner_count' => $others->count(),
                    'owners' => $others->map(fn ($id) => $handles[$id] ?? null)->filter()->values(),
                    '_order' => FabricatorCategory::order($cat, $sub),
                ];
            })
            ->when($request->boolean('owned'), fn ($c) => $c->filter(fn ($r) => $r['owner_ids']->isNotEmpty() || $r['is_default']))
            ->when($request->boolean('unowned_by_me'), fn ($c) => $c->reject(fn ($r) => $r['owned_by_me']))
            ->when($request->boolean('unowned'), fn ($c) => $c->filter(fn ($r) => $r['owner_ids']->isEmpty() && ! $r['is_default']))
            ->values();

        $sort = $request->query('sort', 'kiosk');
        $desc = $request->query('dir') === 'desc';
        $key = match ($sort) {
            'name' => fn ($r) => Str::lower($r['name']),
            'type' => fn ($r) => sprintf('%04d %s', $r['_order'], Str::lower($r['name'])),
            'grade' => fn ($r) => sprintf('%s %s', $r['grade'] ?? '9', Str::lower($r['name'])),
            'owners' => fn ($r) => sprintf('%04d %s', 9999 - $r['owner_ids']->count(), Str::lower($r['name'])),
            default => fn ($r) => sprintf('%04d %s', $r['_order'], Str::lower($r['name'])),
        };
        $rows = $desc ? $rows->sortByDesc($key) : $rows->sortBy($key);
        $rows = $rows->values()->map(fn ($r) => collect($r)->except('_order')->all());

        $perPage = min(200, max(10, (int) $request->query('per_page', 50)));
        $page = max(1, (int) $request->query('page', 1));
        $paginator = new LengthAwarePaginator($rows->forPage($page, $perPage)->values(), $rows->count(), $perPage, $page);

        return $paginator->toArray() + [
            'members' => $members->map(fn ($u) => ['id' => $u->id, 'handle' => $u->handle ?? $u->name])->values(),
            'categories' => FabricatorCategory::options(),
        ];
    }

    /**
     * What a blueprint is: lore and stats (fetched from the wiki once), the
     * kiosk category, who in the org holds it, and how far crafting quality
     * can move its quality-scaling stats. `missions` is reserved for the
     * missions that award it.
     */
    public function show(Request $request, Blueprint $blueprint)
    {
        \App\Support\WikiItem::enrich($blueprint);
        $me = $request->user();
        $members = $this->members($me);
        $ownerIds = BlueprintOwned::whereIn('user_id', $members->pluck('id'))
            ->where('blueprint_id', $blueprint->id)
            ->pluck('user_id')->unique();
        [$cat, $sub] = FabricatorCategory::of($blueprint);

        return [
            'blueprint' => $blueprint->only([
                'id', 'name', 'item_class', 'type', 'sub_type', 'grade', 'tags', 'craft_time_seconds', 'is_default',
                'description', 'image_url', 'manufacturer', 'item_meta', 'game_version', 'classification', 'component_class',
            ]) + ['type_display' => BlueprintKind::label($blueprint)],
            'category_label' => FabricatorCategory::label($cat, $sub),
            'owned_by_me' => $ownerIds->contains($me->id),
            'owners' => $members->filter(fn ($u) => $ownerIds->contains($u->id))
                ->map(fn ($u) => ['id' => $u->id, 'handle' => $u->handle ?? $u->name, 'mine' => $u->id === $me->id])->values(),
            // Community-measured approximation: ≈ ±1.5% per 100 quality around 500, so Q0…Q1000 spans ±7.5%.
            'quality_range' => ['min_percent' => -7.5, 'max_percent' => 7.5],
            'missions' => [],
        ];
    }

    /** Own it or not — one blueprint per player, never consumed. */
    public function toggleOwned(Request $request)
    {
        $data = $request->validate(['blueprint_id' => ['required', 'exists:blueprints,id']]);
        $blueprint = Blueprint::findOrFail($data['blueprint_id']);
        $existing = BlueprintOwned::where('user_id', $request->user()->id)->where('blueprint_id', $blueprint->id)->first();
        if ($existing) {
            $existing->delete();

            return ['owned' => false, 'blueprint_id' => $blueprint->id];
        }
        BlueprintOwned::create([
            'user_id' => $request->user()->id,
            'blueprint_id' => $blueprint->id,
            'blueprint_name' => $blueprint->name,
            'item_class' => $blueprint->item_class,
            'source' => 'manual',
        ]);

        return ['owned' => true, 'blueprint_id' => $blueprint->id];
    }

    /** Mark many as owned at once ("Mark all shown as mine"). */
    public function bulkOwned(Request $request)
    {
        $data = $request->validate([
            'blueprint_ids' => ['required', 'array', 'max:500'],
            'blueprint_ids.*' => ['integer', 'exists:blueprints,id'],
        ]);
        $userId = $request->user()->id;
        $have = BlueprintOwned::where('user_id', $userId)->whereIn('blueprint_id', $data['blueprint_ids'])->pluck('blueprint_id')->all();
        $added = 0;
        foreach (Blueprint::whereIn('id', array_diff($data['blueprint_ids'], $have))->get() as $b) {
            BlueprintOwned::create([
                'user_id' => $userId,
                'blueprint_id' => $b->id,
                'blueprint_name' => $b->name,
                'item_class' => $b->item_class,
                'source' => 'manual',
            ]);
            $added++;
        }

        return ['added' => $added, 'already' => count($have)];
    }

    public function storeOwned(Request $request)
    {
        $data = $request->validate([
            'blueprint_name' => ['required', 'string', 'max:255'],
            'blueprint_id' => ['nullable', 'exists:blueprints,id'],
            'acquired_at' => ['nullable', 'date'],
        ]);

        return BlueprintOwned::firstOrCreate(
            ['user_id' => $request->user()->id, 'blueprint_name' => $data['blueprint_name']],
            [...$data, 'source' => 'manual'],
        );
    }

    public function destroyOwned(Request $request, BlueprintOwned $blueprintOwned)
    {
        abort_unless($blueprintOwned->user_id === $request->user()->id, 403);
        $blueprintOwned->delete();

        return response()->noContent();
    }
}
