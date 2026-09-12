<?php

namespace App\Http\Controllers;

use App\Models\Blueprint;
use App\Models\BlueprintOwned;
use App\Models\BlueprintPoolEntry;
use App\Models\User;
use App\Support\BlueprintKind;
use App\Support\CraftModifiers;
use App\Support\FabricatorCategory;
use App\Support\OrgMembers;
use App\Support\WikiItem;
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
        return OrgMembers::of($me);
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
        $pools = $this->poolProgress($me);

        $category = $request->query('category');
        $rows = Blueprint::query()
            ->when($request->query('search'), fn ($q, $s) => $q->whereLike('name', "%{$s}%", caseSensitive: false))
            ->when($request->query('grade'), fn ($q, $g) => $q->where('grade', $g))
            ->orderBy('name')
            ->get()
            ->filter(fn (Blueprint $b) => ! $category || FabricatorCategory::matches($b, $category))
            ->map(function (Blueprint $b) use ($owned, $me, $handles, $pools) {
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
                    // The reward pools this recipe is in and how far through
                    // each the viewer is, so a list can be read for what is
                    // worth flying for rather than one row at a time.
                    'pools' => $pools[$b->id] ?? [],
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
            // Nearest to a finished pool first, and recipes no mission awards
            // last either way round — there is nothing to complete there.
            'pool' => fn ($r) => sprintf(
                '%d %04d %s',
                $r['pools'] === [] ? 1 : 0,
                9999 - (int) ($r['pools'][0]['owned_percent'] ?? 0),
                Str::lower($r['name']),
            ),
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
     * kiosk category, who in the org holds it, how far crafting quality can
     * move its quality-scaling stats, and which missions award it.
     */
    public function show(Request $request, Blueprint $blueprint)
    {
        WikiItem::enrich($blueprint);
        CraftModifiers::enrich($blueprint);
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
            // The recipe's slots and the stats their materials modify.
            'requirement_groups' => CraftModifiers::groups($blueprint->requirement_groups),
            // What crafting can do to each modified property, worst to best
            // material in every recipe slot: property_key → [min%, max%].
            'stat_ranges' => collect(CraftModifiers::extremes($blueprint->requirement_groups))
                ->map(fn (array $ends) => [
                    'min_percent' => round(($ends[0] - 1) * 100, 2),
                    'max_percent' => round(($ends[1] - 1) * 100, 2),
                ])->all(),
            'missions' => $this->pools($blueprint, $me),
        ];
    }

    /**
     * Every recipe's pools and the viewer's progress through each, keyed by
     * blueprint id.
     *
     * Two queries for the whole catalogue rather than two per row: the pool
     * tables are small (a few hundred rows all told) and the checklist shows
     * two hundred blueprints at a time.
     */
    private function poolProgress(User $me): array
    {
        $entries = BlueprintPoolEntry::with('pool:id,key,record')->get();
        $mine = BlueprintOwned::where('user_id', $me->id)->pluck('blueprint_id')
            ->merge(Blueprint::where('is_default', true)->pluck('id'))
            ->filter()->unique()->all();

        $byPool = $entries->groupBy('blueprint_pool_id');
        $progress = [];
        foreach ($byPool as $poolId => $members) {
            $pool = $members->first()->pool;
            if ($pool === null) {
                continue;
            }
            $held = $members->filter(fn (BlueprintPoolEntry $e) => in_array($e->blueprint_id, $mine, true))->count();
            $progress[$poolId] = [
                'pool_key' => $pool->key,
                'pool_label' => $pool->label(),
                'in_pool' => $members->count(),
                'owned_in_pool' => $held,
                'owned_percent' => $members->count() > 0 ? (int) round($held / $members->count() * 100) : null,
            ];
        }

        $byBlueprint = [];
        foreach ($entries as $entry) {
            if ($entry->blueprint_id === null || ! isset($progress[$entry->blueprint_pool_id])) {
                continue;
            }
            $byBlueprint[$entry->blueprint_id][] = $progress[$entry->blueprint_pool_id];
        }

        // The smallest pool first, which is the same order the detail dialog
        // shows: fewest recipes in it is the best chance of this one.
        foreach ($byBlueprint as $id => $rows) {
            usort($rows, fn ($a, $b) => $a['in_pool'] <=> $b['in_pool']);
            $byBlueprint[$id] = $rows;
        }

        return $byBlueprint;
    }

    /**
     * Where the recipe comes from: the reward pools holding it, what the draw
     * is worth, and who to ask for the mission.
     *
     * A blueprint is not bought. Completing a mission draws one blueprint from
     * the pool its contract names, so what a player wants to know is which
     * missions feed a pool this recipe is in, how thin the pool is spread, and
     * what else is in there — a pool whose other recipes they already hold is
     * a pool worth farming, and one they have nothing from is a long evening.
     */
    private function pools(Blueprint $blueprint, User $me): array
    {
        $entries = BlueprintPoolEntry::with('pool.entries.blueprint')
            ->where('blueprint_id', $blueprint->id)
            ->get();

        $pooled = $entries->flatMap(fn (BlueprintPoolEntry $e) => $e->pool->entries->pluck('blueprint_id'))
            ->filter()->unique();
        $mine = BlueprintOwned::where('user_id', $me->id)
            ->whereIn('blueprint_id', $pooled)
            ->pluck('blueprint_id')
            ->all();

        return $entries
            ->map(function (BlueprintPoolEntry $entry) use ($blueprint, $mine) {
                $pool = $entry->pool;
                $total = (float) $pool->entries->sum('weight');
                // Every recipe in the pool, so the player can see what else
                // the same mission might hand them. A pool entry the wiki has
                // no recipe for yet keeps its key and says nothing more.
                $contents = $pool->entries
                    ->map(fn (BlueprintPoolEntry $sibling) => [
                        'blueprint_id' => $sibling->blueprint_id,
                        'key' => $sibling->blueprint_key,
                        'name' => $sibling->blueprint?->name,
                        'draw_percent' => $total > 0 ? round($sibling->weight / $total * 100, 1) : null,
                        'owned' => in_array($sibling->blueprint_id, $mine, true)
                            || (bool) $sibling->blueprint?->is_default,
                        'is_this_one' => $sibling->blueprint_id === $blueprint->id,
                    ])
                    // The one being looked at first, then what is still
                    // missing, because that is what the farming is for.
                    ->sortBy(fn (array $row) => [! $row['is_this_one'], $row['owned'], $row['name'] ?? $row['key']])
                    ->values()
                    ->all();

                return [
                    'pool_key' => $pool->key,
                    'pool_label' => $pool->label(),
                    'in_pool' => $pool->entries->count(),
                    'owned_in_pool' => collect($contents)->where('owned', true)->count(),
                    // How far through the pool the player is. This is the
                    // number that says whether the mission is still worth
                    // flying: a pool they hold nine tenths of has little left
                    // to give them.
                    'owned_percent' => $pool->entries->count() > 0
                        ? round(collect($contents)->where('owned', true)->count() / $pool->entries->count() * 100)
                        : null,
                    'contents' => $contents,
                    // This recipe's share of one draw from the pool.
                    'draw_percent' => $total > 0 ? round($entry->weight / $total * 100, 1) : null,
                    'sources' => $pool->sources ?? [],
                ];
            })
            // The tightest pool first: it is the best chance of the recipe.
            ->sortByDesc('draw_percent')
            ->values()
            ->all();
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
