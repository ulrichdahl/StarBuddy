<?php

namespace App\Http\Controllers;

use App\Models\Blueprint;
use App\Models\BlueprintOwned;
use App\Models\ResourceStack;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The craftability engine (spec F5/F6): joins the ledger the member can see
 * with the recipe database. For every blueprint someone in the org owns (or
 * that is available by default), reports whether it is craftable right now,
 * how close it is (coverage), what is missing, and the best output quality
 * achievable from the stacks on hand.
 */
class CraftabilityController extends Controller
{
    /**
     * Craft detail: item lore/stats (lazily cached from the wiki), which org
     * members hold the blueprint, and who has each ingredient where.
     */
    public function show(Request $request, Blueprint $blueprint)
    {
        $this->enrichFromWiki($blueprint);
        $user = $request->user();

        $orgUserIds = $user->orgs()->with('members:users.id')->get()
            ->flatMap(fn ($org) => $org->members->pluck('id'))
            ->push($user->id)
            ->unique();

        $owners = BlueprintOwned::where('blueprint_id', $blueprint->id)
            ->whereIn('user_id', $orgUserIds)
            ->with('user:id,name,handle')
            ->get()
            ->map(fn ($r) => $r->user->handle ?? $r->user->name)
            ->unique()
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
                    'member' => $s->user->handle ?? $s->user->name,
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
                'manufacturer', 'item_meta', 'game_version',
            ]),
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
     * Record a completed craft: consume the ingredients from the stacks the
     * member can use (best quality first — the same order the estimate
     * shows) and add the crafted item to their item ledger.
     */
    public function craft(Request $request, Blueprint $blueprint)
    {
        $data = $request->validate(['location_id' => ['nullable', 'exists:locations,id']]);
        $user = $request->user();

        return DB::transaction(function () use ($blueprint, $user, $data) {
            $consumed = [];
            $qualityWeighted = 0;
            $qualityWeight = 0;
            $fallbackLocation = null;

            foreach ($blueprint->ingredients ?? [] as $ing) {
                $need = $ing['quantity_mscu'] ?? $ing['quantity_pieces'] ?? 0;
                if ($need <= 0) {
                    continue;
                }
                $isMscu = isset($ing['quantity_mscu']);

                $stacks = ResourceStack::visibleTo($user)
                    ->whereHas('resourceType', fn ($q) => $q->whereLike('name', $ing['name'], caseSensitive: false))
                    ->when($isMscu, fn ($q) => $q->where('quality', '>=', 1))
                    ->orderByDesc('quality')
                    ->lockForUpdate()
                    ->get();

                abort_if($stacks->sum('quantity') < $need, 422, "Not enough {$ing['name']} on hand.");

                $left = $need;
                foreach ($stacks as $stack) {
                    if ($left <= 0) {
                        break;
                    }
                    $use = min($left, $stack->quantity);
                    $left -= $use;
                    $fallbackLocation ??= $stack->location_id;
                    if ($isMscu) {
                        $qualityWeighted += $use * $stack->quality;
                        $qualityWeight += $use;
                    }
                    if ($use === $stack->quantity) {
                        $stack->delete();
                    } else {
                        $stack->update(['quantity' => $stack->quantity - $use, 'updated_by' => $user->id]);
                    }
                }
                $consumed[] = ['name' => $ing['name'], 'quantity' => $need, 'unit' => $isMscu ? 'mscu' : 'pieces'];
            }

            abort_if(empty($consumed), 422, 'This blueprint has no recorded ingredients.');

            $quality = $qualityWeight > 0 ? (int) round($qualityWeighted / $qualityWeight) : null;
            $item = \App\Models\ItemStack::create([
                'user_id' => $user->id,
                'org_id' => $user->orgs()->value('orgs.id'),
                'location_id' => $data['location_id'] ?? $fallbackLocation,
                'item_class' => $blueprint->item_class ?? $blueprint->name,
                'item_name' => $blueprint->name.($quality !== null ? " (Q{$quality})" : ''),
                'quantity' => 1,
                'visibility' => 'private',
                'source' => 'manual',
            ]);

            \App\Models\AuditLog::create([
                'user_id' => $user->id,
                'org_id' => $user->orgs()->value('orgs.id'),
                'action' => 'craft.completed',
                'details' => ['blueprint' => $blueprint->name, 'quality' => $quality, 'consumed' => $consumed],
            ]);

            return [
                'crafted' => $blueprint->name,
                'quality' => $quality,
                'consumed' => $consumed,
                'item_stack_id' => $item->id,
            ];
        });
    }

    // One-time fetch of the output item's lore from the wiki, cached on the
    // row ('' marks "fetched, nothing there" so we never refetch in a loop).
    private function enrichFromWiki(Blueprint $blueprint): void
    {
        if ($blueprint->description !== null || ! $blueprint->uuid) {
            return;
        }

        $data = ['description' => ''];
        try {
            $bp = \Illuminate\Support\Facades\Http::acceptJson()->timeout(15)
                ->get("https://api.star-citizen.wiki/api/v2/blueprints/{$blueprint->uuid}")
                ->json('data');

            if ($itemUuid = $bp['output_item_uuid'] ?? null) {
                $item = \Illuminate\Support\Facades\Http::acceptJson()->timeout(15)
                    ->get("https://api.star-citizen.wiki/api/v2/items/{$itemUuid}")
                    ->json('data');

                $data = [
                    'description' => $item['description']['en_EN'] ?? '',
                    'image_url' => $item['images'][0]['thumbnail_url'] ?? $item['images'][0]['original_url'] ?? null,
                    'manufacturer' => $item['manufacturer']['name'] ?? null,
                    'item_meta' => array_filter([
                        'mass' => $item['mass'] ?? null,
                        'size' => $item['size'] ?? null,
                        'item_grade' => $item['grade'] ?? null,
                        'classification' => $item['classification_label'] ?? null,
                    ]),
                ];
            }
        } catch (\Throwable) {
            // Offline or wiki hiccup — leave description null to retry later.
            return;
        }

        $blueprint->update($data);
    }

    public function __invoke(Request $request)
    {
        $user = $request->user();

        // ── Availability: resource name → sorted [quality, quantity] stacks ──
        $availability = [];
        ResourceStack::visibleTo($user)
            ->with('resourceType:id,name,unit')
            ->get()
            ->each(function ($s) use (&$availability) {
                // Quality 0 stock cannot be crafted with; gems are exempt.
                if ($s->resourceType->unit === 'mscu' && $s->quality < 1) {
                    return;
                }
                $key = Str::lower($s->resourceType->name);
                $availability[$key]['unit'] = $s->resourceType->unit;
                $availability[$key]['total'] = ($availability[$key]['total'] ?? 0) + $s->quantity;
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
            ->with('user:id,name,handle')
            ->get()
            ->groupBy('blueprint_id')
            ->map(fn ($rows) => $rows->map(fn ($r) => $r->user->handle ?? $r->user->name)->unique()->values());

        // ── Evaluate recipes ──
        $query = Blueprint::whereNotNull('ingredients')
            ->when($request->query('search'), fn ($q, $s) => $q->whereLike('name', "%{$s}%", caseSensitive: false))
            ->when($request->query('type'), fn ($q, $t) => $q->where('type', $t))
            ->when($request->query('grade'), fn ($q, $g) => $q->where('grade', $g));

        if (! $request->boolean('all')) {
            $query->where(fn ($q) => $q->whereIn('id', $owners->keys())->orWhere('is_default', true));
        }

        $results = $query->get()->map(function (Blueprint $bp) use ($availability, $owners) {
            $coverage = 1.0;
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
                'owners' => $owners[$bp->id] ?? [],
                'craftable' => $coverage >= 1.0,
                'coverage' => round($coverage, 3),
                'missing' => $missing,
                'est_output_quality' => $qualityWeight > 0 ? (int) round($qualityWeighted / $qualityWeight) : null,
            ];
        });

        if ($request->boolean('craftable')) {
            $results = $results->filter(fn ($r) => $r['craftable']);
        }

        return [
            'types' => Blueprint::whereNotNull('type')->distinct()->orderBy('type')->pluck('type'),
            'results' => $results
                ->sortBy([['craftable', 'desc'], ['coverage', 'desc'], ['est_output_quality', 'desc']])
                ->values()
                ->take(300),
        ];
    }
}
