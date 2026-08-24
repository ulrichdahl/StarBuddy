<?php

namespace App\Http\Controllers;

use App\Models\Blueprint;
use App\Models\BlueprintOwned;
use App\Models\ResourceStack;
use Illuminate\Http\Request;
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
