<?php

namespace App\Support;

use App\Models\Blueprint;
use App\Models\BlueprintOwned;
use App\Models\ResourceStack;
use App\Models\User;
use Illuminate\Support\Str;

/**
 * The craftability engine (spec F5/F6), shared by the web API and the
 * Discord bot: joins the ledger a member can see with the recipe database.
 */
class Craftability
{
    /**
     * Craft detail for one recipe: which org members hold the blueprint
     * (with their use counts), who has each ingredient where, and the best
     * output quality achievable from what is on hand.
     */
    public static function detail(User $user, Blueprint $blueprint): array
    {
        $orgUserIds = $user->orgs()->with('members:users.id')->get()
            ->flatMap(fn ($org) => $org->members->pluck('id'))
            ->push($user->id)
            ->unique();

        $owners = BlueprintOwned::where('blueprint_id', $blueprint->id)
            ->whereIn('user_id', $orgUserIds)
            ->with('user:id,name,handle')
            ->get()
            ->unique('user_id')
            ->map(fn ($r) => [
                'id' => $r->id,
                'member' => $r->user->handle ?? $r->user->name,
                'mine' => $r->user_id === $user->id,
                'uses_personal' => $r->uses_personal,
                'uses_org' => $r->uses_org,
            ])
            ->values();

        $ingredients = collect($blueprint->ingredients ?? [])->map(function ($ing) use ($user) {
            $need = $ing['quantity_mscu'] ?? $ing['quantity_pieces'] ?? 0;
            $unit = isset($ing['quantity_mscu']) ? 'mscu' : 'pieces';

            $holdings = ResourceStack::visibleTo($user)
                ->whereHas('resourceType', fn ($q) => $q->whereLike('name', $ing['name'], caseSensitive: false))
                ->where(fn ($q) => $unit === 'mscu' ? $q->where('quality', '>=', 1) : $q)
                ->with(['user:id,name,handle', 'location:id,name,system'])
                ->orderByDesc('quality')
                ->get()
                ->map(fn ($s) => [
                    'id' => $s->id,
                    'member' => $s->user->handle ?? $s->user->name,
                    'mine' => $s->user_id === $user->id,
                    'location' => $s->location->name,
                    'system' => $s->location->system,
                    'quality' => $s->quality,
                    'quantity' => $s->quantity,
                ]);

            return [
                'name' => $ing['name'],
                'kind' => $ing['kind'] ?? null,
                'need' => $need,
                'unit' => $unit,
                'available' => $holdings->sum('quantity'),
                'holdings' => $holdings,
            ];
        });

        // Best achievable output quality: greedily consume the highest-
        // quality stacks per crated ingredient, weighted by recipe share.
        $weighted = 0;
        $weight = 0;
        $craftable = true;
        foreach ($ingredients as $ing) {
            if ($ing['available'] < $ing['need']) {
                $craftable = false;
            }
            if ($ing['unit'] !== 'mscu' || $ing['need'] <= 0) {
                continue;
            }
            $left = min($ing['need'], $ing['available']);
            $sum = 0;
            foreach ($ing['holdings'] as $h) { // already sorted best-first
                if ($left <= 0) {
                    break;
                }
                $use = min($left, $h['quantity']);
                $sum += $use * $h['quality'];
                $left -= $use;
            }
            $weighted += $sum;
            $weight += $ing['need'];
        }
        $estQuality = $weight > 0 ? (int) round($weighted / $weight) : null;

        return [
            'blueprint' => $blueprint->only([
                'id', 'name', 'item_class', 'type', 'sub_type', 'grade', 'tags',
                'craft_time_seconds', 'is_default', 'description', 'image_url',
                'manufacturer', 'item_meta', 'game_version', 'classification',
                'component_class',
            ]) + ['type_display' => \App\Support\BlueprintKind::label($blueprint)],
            'owners' => $owners,
            'ingredients' => $ingredients,
            'craftable' => $craftable,
            'est_output_quality' => $estQuality,
            // Community-measured approximation: stats shift roughly linearly
            // with quality around a ~500 baseline (≈ ±1.5% per 100 quality).
            'est_stat_modifier_percent' => $estQuality !== null
                ? round(($estQuality - 500) * 0.015, 1)
                : null,
        ];
    }

    /**
     * Evaluate every recipe the member's orgs own (or all, with `all`):
     * craftable now, coverage, missing materials, best output quality.
     * Filters: search, type, types (list), group (BlueprintKind group key), grade, material (ingredient name), all, craftable.
     */
    public static function evaluate(User $user, array $filters = []): array
    {
        // ── Availability: resource name → sorted [quality, quantity] stacks ──
        $availability = [];
        ResourceStack::visibleTo($user)
            ->with('resourceType:id,name,unit')
            ->get()
            ->each(function ($s) use (&$availability, $user) {
                // Quality 0 stock cannot be crafted with; gems are exempt.
                if ($s->resourceType->unit === 'mscu' && $s->quality < 1) {
                    return;
                }
                $key = Str::lower($s->resourceType->name);
                $availability[$key]['unit'] = $s->resourceType->unit;
                $availability[$key]['total'] = ($availability[$key]['total'] ?? 0) + $s->quantity;
                // Private = only you can use it; everything else visible here is org-shared.
                if ($s->user_id === $user->id && $s->visibility === 'private') {
                    $availability[$key]['private'] = ($availability[$key]['private'] ?? 0) + $s->quantity;
                }
                $availability[$key]['stacks'][] = ['quality' => $s->quality, 'quantity' => $s->quantity];
            });
        foreach ($availability as &$a) {
            usort($a['stacks'], fn ($x, $y) => $y['quality'] <=> $x['quality']);
        }
        unset($a);

        // ── Who owns which blueprint, across the member's orgs ──
        $orgUserIds = $user->orgs()->with('members:users.id')->get()
            ->flatMap(fn ($org) => $org->members->pluck('id'))
            ->push($user->id)
            ->unique();
        $owners = BlueprintOwned::whereIn('user_id', $orgUserIds)
            ->whereNotNull('blueprint_id')
            ->get(['blueprint_id', 'user_id'])
            ->groupBy('blueprint_id')
            ->map(fn ($rows) => $rows->pluck('user_id')->unique());

        // ── Evaluate recipes ──
        $query = Blueprint::whereNotNull('ingredients')
            ->when(($filters['search'] ?? null), fn ($q, $s) => $q->whereLike('name', "%{$s}%", caseSensitive: false))
            ->when(($filters['type'] ?? null), fn ($q, $t) => $q->where('type', $t))
            ->when(($filters['types'] ?? null), fn ($q, $ts) => $q->whereIn('type', $ts))
            ->when(($filters['group'] ?? null), fn ($q, $g) => $q->whereIn('type',
                Blueprint::whereNotNull('type')->distinct()->pluck('type')->filter(fn ($t) => BlueprintKind::group($t) === $g)->values()))
            // Recipes consuming a material: ingredients is JSON, match its text.
            ->when(($filters['material'] ?? null), fn ($q, $m) => $q->whereRaw('ingredients::text ILIKE ?', ['%"name":"%'.str_replace(['%', '_'], ['\\%', '\\_'], $m).'%"%']))
            ->when(($filters['grade'] ?? null), fn ($q, $g) => $q->where('grade', $g));

        if (! ! empty($filters['all'])) {
            $query->where(fn ($q) => $q->whereIn('id', $owners->keys())->orWhere('is_default', true));
        }

        $results = $query->get()->map(function (Blueprint $bp) use ($availability, $owners, $user) {
            $coverage = 1.0;
            // Bar composition: how much of the covered material is private vs
            // org-shared, summed over ingredients (not a bottleneck like coverage).
            $coveredSum = 0.0;
            $privateSum = 0.0;
            $missing = [];
            $qualityWeighted = 0;
            $qualityWeight = 0;

            foreach ($bp->ingredients as $ing) {
                $need = $ing['quantity_mscu'] ?? $ing['quantity_pieces'] ?? 0;
                if ($need <= 0) {
                    continue;
                }
                $have = $availability[Str::lower($ing['name'])] ?? null;
                $ratio = min(1.0, ($have['total'] ?? 0) / $need);
                $coverage = min($coverage, $ratio);
                $coveredSum += $ratio;
                $privateSum += min(1.0, ($have['private'] ?? 0) / $need);

                if ($ratio < 1.0) {
                    $missing[] = [
                        'name' => $ing['name'],
                        'missing' => $need - ($have['total'] ?? 0),
                        'unit' => isset($ing['quantity_mscu']) ? 'mscu' : 'pieces',
                    ];
                }

                // Best achievable input quality: consume highest-quality
                // stacks first; resources only (gems carry no output weight).
                if (isset($ing['quantity_mscu']) && $have) {
                    $left = min($need, $have['total']);
                    $taken = 0;
                    $sum = 0;
                    foreach ($have['stacks'] as $stack) {
                        if ($left <= 0) {
                            break;
                        }
                        $use = min($left, $stack['quantity']);
                        $sum += $use * $stack['quality'];
                        $taken += $use;
                        $left -= $use;
                    }
                    if ($taken > 0) {
                        $qualityWeighted += $sum;
                        $qualityWeight += $need; // weight by full need, not just what we have
                    }
                }
            }

            return [
                'id' => $bp->id,
                'name' => $bp->name,
                'item_class' => $bp->item_class,
                'type' => $bp->type,
                'sub_type' => $bp->sub_type,
                'grade' => $bp->grade,
                'tags' => $bp->tags,
                'craft_time_seconds' => $bp->craft_time_seconds,
                'is_default' => $bp->is_default,
                'type_display' => \App\Support\BlueprintKind::label($bp),
                // Who owns it stays in the detail endpoint — the list only
                // needs whether the viewer has it and how many OTHERS do.
                'owner_count' => ($owners[$bp->id] ?? collect())->reject(fn ($id) => $id === $user->id)->count(),
                'owned_by_me' => ($owners[$bp->id] ?? collect())->contains($user->id),
                'craftable' => $coverage >= 1.0,
                'coverage' => round($coverage, 3),
                // Private share of the bar, scaled so private + org = coverage.
                'coverage_private' => $coveredSum > 0 ? round($coverage * $privateSum / $coveredSum, 3) : 0.0,
                // Size matters for ship parts: components and vehicle weapons.
                'size' => in_array(BlueprintKind::group($bp->type), ['vehicle_components', 'vehicle_weapons'], true)
                    ? ($bp->item_meta['size'] ?? null)
                    : null,
                'missing' => $missing,
                'est_output_quality' => $qualityWeight > 0 ? (int) round($qualityWeighted / $qualityWeight) : null,
            ];
        });

        if (! empty($filters['craftable'])) {
            $results = $results->filter(fn ($r) => $r['craftable']);
        }

        return [
            // Grouped for the filter dropdown: vehicle components, character
            // armor, … each with its member types.
            'types' => BlueprintKind::groupedTypes(Blueprint::whereNotNull('type')->whereNotNull('ingredients')->distinct()->pluck('type')),
            // Real count before the cap, so callers can say "…and N more".
            'total' => $results->count(),
            'results' => $results
                ->sortBy([['craftable', 'desc'], ['coverage', 'desc'], ['est_output_quality', 'desc']])
                ->values()
                ->take(300),
        ];
    }
}
