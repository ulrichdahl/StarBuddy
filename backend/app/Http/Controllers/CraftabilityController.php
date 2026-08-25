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
     * Record completed crafts: consume the ingredients (from the specific
     * stacks the member picked, or best quality first when none were),
     * mark a use on the blueprint copy that was used, and add the crafted
     * items to the member's item ledger.
     */
    public function craft(Request $request, Blueprint $blueprint)
    {
        $data = $request->validate([
            'quantity' => ['nullable', 'integer', 'min:1', 'max:100'],
            'use_type' => ['nullable', 'in:personal,org'],
            'owned_id' => ['nullable', 'integer', 'exists:blueprint_owned,id'],
            'stack_ids' => ['nullable', 'array'],
            'stack_ids.*' => ['integer'],
            'location_id' => ['nullable', 'exists:locations,id'],
        ]);
        $user = $request->user();
        $quantity = $data['quantity'] ?? 1;
        $stackIds = $data['stack_ids'] ?? null;

        return DB::transaction(function () use ($blueprint, $user, $data, $quantity, $stackIds) {
            $consumed = [];
            $stackConsumption = [];
            $qualityWeighted = 0;
            $qualityWeight = 0;
            $fallbackLocation = null;

            foreach ($blueprint->ingredients ?? [] as $ing) {
                $perCraft = $ing['quantity_mscu'] ?? $ing['quantity_pieces'] ?? 0;
                if ($perCraft <= 0) {
                    continue;
                }
                $need = $perCraft * $quantity;
                $isMscu = isset($ing['quantity_mscu']);

                $stacks = ResourceStack::visibleTo($user)
                    ->whereHas('resourceType', fn ($q) => $q->whereLike('name', $ing['name'], caseSensitive: false))
                    ->when($isMscu, fn ($q) => $q->where('quality', '>=', 1))
                    ->when($stackIds !== null, fn ($q) => $q->whereIn('id', $stackIds))
                    ->orderByDesc('quality')
                    ->lockForUpdate()
                    ->get();

                abort_if($stacks->sum('quantity') < $need, 422,
                    "Not enough {$ing['name']}".($stackIds !== null ? ' in the selected stacks' : ' on hand').'.');

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
                    // Everything an undo needs to put this back, even if
                    // the stack row is deleted below.
                    $stackConsumption[] = [
                        'stack_id' => $stack->id,
                        'user_id' => $stack->user_id,
                        'org_id' => $stack->org_id,
                        'resource_type_id' => $stack->resource_type_id,
                        'location_id' => $stack->location_id,
                        'quality' => $stack->quality,
                        'visibility' => $stack->visibility,
                        'used' => $use,
                    ];
                    if ($use === $stack->quantity) {
                        $stack->delete();
                    } else {
                        $stack->update(['quantity' => $stack->quantity - $use, 'updated_by' => $user->id]);
                    }
                }
                $consumed[] = ['name' => $ing['name'], 'quantity' => $need, 'unit' => $isMscu ? 'mscu' : 'pieces'];
            }

            abort_if(empty($consumed), 422, 'This blueprint has no recorded ingredients.');

            // The blueprint itself is never consumed — count the use on the
            // copy that was used (the chosen one, or the crafter's own).
            $useType = $data['use_type'] ?? 'personal';
            $owned = isset($data['owned_id'])
                ? BlueprintOwned::where('id', $data['owned_id'])->where('blueprint_id', $blueprint->id)->first()
                : BlueprintOwned::where('blueprint_id', $blueprint->id)->where('user_id', $user->id)->first();
            $owned?->increment($useType === 'org' ? 'uses_org' : 'uses_personal', $quantity);

            $quality = $qualityWeight > 0 ? (int) round($qualityWeighted / $qualityWeight) : null;
            $item = \App\Models\ItemStack::create([
                'user_id' => $user->id,
                'org_id' => $user->orgs()->value('orgs.id'),
                'location_id' => $data['location_id'] ?? $fallbackLocation,
                'item_class' => $blueprint->item_class ?? $blueprint->name,
                'item_name' => $blueprint->name.($quality !== null ? " (Q{$quality})" : ''),
                'quantity' => $quantity,
                'visibility' => 'private',
                'source' => 'manual',
            ]);

            $audit = \App\Models\AuditLog::create([
                'user_id' => $user->id,
                'org_id' => $user->orgs()->value('orgs.id'),
                'action' => 'craft.completed',
                'details' => [
                    'blueprint' => $blueprint->name,
                    'quantity' => $quantity,
                    'use_type' => $useType,
                    'owned_id' => $owned?->id,
                    'blueprint_owner' => $owned?->user_id,
                    'quality' => $quality,
                    'consumed' => $consumed,
                    'item_stack_id' => $item->id,
                    'stack_consumption' => $stackConsumption,
                ],
            ]);

            return [
                'crafted' => $blueprint->name,
                'quantity' => $quantity,
                'quality' => $quality,
                'consumed' => $consumed,
                'item_stack_id' => $item->id,
                'craft_id' => $audit->id,
            ];
        });
    }

    /**
     * Undo a recorded craft: give every consumed stack its amount back
     * (recreating stacks that were emptied and deleted), remove the crafted
     * items from the ledger, and roll back the blueprint use counter.
     */
    public function undoCraft(Request $request, \App\Models\AuditLog $audit)
    {
        $user = $request->user();
        abort_if($audit->action !== 'craft.completed', 404);
        abort_if($audit->user_id !== $user->id, 403, 'Only the member who recorded the craft can undo it.');
        abort_if(isset($audit->details['undone_at']), 422, 'This craft has already been undone.');
        abort_unless(isset($audit->details['stack_consumption']), 422,
            'This craft predates undo support and cannot be reversed automatically.');

        return DB::transaction(function () use ($audit, $user) {
            $details = $audit->details;

            foreach ($details['stack_consumption'] as $c) {
                $stack = ResourceStack::lockForUpdate()->find($c['stack_id']);
                if ($stack) {
                    $stack->update([
                        'quantity' => $stack->quantity + $c['used'],
                        'updated_by' => $user->id,
                    ]);
                } else {
                    ResourceStack::create([
                        'user_id' => $c['user_id'],
                        'org_id' => $c['org_id'],
                        'resource_type_id' => $c['resource_type_id'],
                        'location_id' => $c['location_id'],
                        'quality' => $c['quality'],
                        'quantity' => $c['used'],
                        'visibility' => $c['visibility'],
                        'source' => 'manual',
                        'updated_by' => $user->id,
                    ]);
                }
            }

            $quantity = $details['quantity'] ?? 1;
            if ($item = \App\Models\ItemStack::lockForUpdate()->find($details['item_stack_id'] ?? 0)) {
                if ($item->quantity > $quantity) {
                    $item->update(['quantity' => $item->quantity - $quantity]);
                } else {
                    $item->delete();
                }
            }

            if ($owned = BlueprintOwned::find($details['owned_id'] ?? 0)) {
                $col = ($details['use_type'] ?? 'personal') === 'org' ? 'uses_org' : 'uses_personal';
                $owned->update([$col => max(0, $owned->{$col} - $quantity)]);
            }

            $details['undone_at'] = now()->toIso8601String();
            $audit->update(['details' => $details]);

            \App\Models\AuditLog::create([
                'user_id' => $user->id,
                'org_id' => $audit->org_id,
                'action' => 'craft.undone',
                'details' => [
                    'craft_id' => $audit->id,
                    'blueprint' => $details['blueprint'],
                    'quantity' => $quantity,
                ],
            ]);

            return ['undone' => true, 'restored' => $details['consumed'] ?? []];
        });
    }

    /**
     * Item stat blocks worth caching from the wiki item payload, per type.
     * Unknown keys are simply absent from a given item.
     */
    private const STAT_BLOCKS = [
        'personal_weapon', 'vehicle_weapon', 'clothing', 'shield',
        'power_plant', 'cooler', 'quantum_drive', 'radar', 'tractor_beam',
        'mining_laser', 'salvage_modifier', 'weapon_attachment', 'melee',
        'temperature_resistance', 'radiation_resistance', 'inventory',
        'durability',
    ];

    // Bump when the captured shape changes — rows with an older (or no)
    // marker re-fetch on next open.
    private const STATS_VERSION = 1;

    // One-time fetch of the output item's lore and stat blocks from the
    // wiki, cached on the row ('' description marks "fetched, nothing
    // there" so we never refetch in a loop).
    private function enrichFromWiki(Blueprint $blueprint): void
    {
        $upToDate = $blueprint->description !== null
            && ($blueprint->item_meta['stats_v'] ?? 0) >= self::STATS_VERSION;
        if ($upToDate || ! $blueprint->uuid) {
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

                $stats = [];
                foreach (self::STAT_BLOCKS as $key) {
                    if (! empty($item[$key]) && is_array($item[$key])) {
                        $stats[$key] = self::pruneStats($item[$key]);
                    }
                }

                $data = [
                    'description' => $item['description']['en_EN'] ?? '',
                    'image_url' => $item['images'][0]['thumbnail_url'] ?? $item['images'][0]['original_url'] ?? null,
                    'manufacturer' => $item['manufacturer']['name'] ?? null,
                    'item_meta' => array_filter([
                        'mass' => $item['mass'] ?? null,
                        'size' => $item['size'] ?? null,
                        'item_grade' => $item['grade'] ?? null,
                        'classification' => $item['classification_label'] ?? null,
                        'stats' => $stats ?: null,
                    ]) + ['stats_v' => self::STATS_VERSION],
                ];
            }
        } catch (\Throwable) {
            // Offline or wiki hiccup — leave description null to retry later.
            return;
        }

        $blueprint->update($data);
    }

    /**
     * The wiki blocks carry dozens of nulls and some huge sub-trees the UI
     * never shows — drop those, and boil ammunition down to what matters.
     */
    private static function pruneStats(array $block): array
    {
        unset($block['damages'], $block['magazine_volume'], $block['ads_spread'],
            $block['damage_resistance'], $block['protected_body_parts'],
            $block['spline_jump'], $block['standard_jump']);

        if (isset($block['ammunition']) && is_array($block['ammunition'])) {
            $ammo = $block['ammunition'];
            $block['ammunition'] = array_filter([
                'speed' => $ammo['speed'] ?? null,
                'range' => $ammo['range'] ?? null,
                'size' => $ammo['size'] ?? null,
            ], fn ($v) => $v !== null);
        }

        // Fire / jump modes: keep only what the stats panel renders.
        if (isset($block['modes']) && is_array($block['modes'])) {
            $keep = array_flip([
                'mode', 'localised', 'type', 'rpm', 'ammo_per_shot',
                'pellets_per_shot', 'damage_per_second', 'shot_count',
                'drive_speed_formatted', 'cooldown_time', 'spool_up_time',
            ]);
            $block['modes'] = array_values(array_map(
                fn ($m) => is_array($m) ? array_intersect_key($m, $keep) : $m,
                $block['modes'],
            ));
        }

        return self::pruneNulls($block);
    }

    private static function pruneNulls(array $arr): array
    {
        $out = [];
        foreach ($arr as $k => $v) {
            if (is_array($v)) {
                $v = self::pruneNulls($v);
                if ($v === []) {
                    continue;
                }
            }
            if ($v !== null) {
                $out[$k] = $v;
            }
        }

        return $out;
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
            ->get(['blueprint_id', 'user_id'])
            ->groupBy('blueprint_id')
            ->map(fn ($rows) => $rows->pluck('user_id')->unique());

        // ── Evaluate recipes ──
        $query = Blueprint::whereNotNull('ingredients')
            ->when($request->query('search'), fn ($q, $s) => $q->whereLike('name', "%{$s}%", caseSensitive: false))
            ->when($request->query('type'), fn ($q, $t) => $q->where('type', $t))
            ->when($request->query('grade'), fn ($q, $g) => $q->where('grade', $g));

        if (! $request->boolean('all')) {
            $query->where(fn ($q) => $q->whereIn('id', $owners->keys())->orWhere('is_default', true));
        }

        $results = $query->get()->map(function (Blueprint $bp) use ($availability, $owners, $user) {
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
                // Who owns it stays in the detail endpoint — the list only
                // needs a count and whether the viewer is among them.
                'owner_count' => ($owners[$bp->id] ?? collect())->count(),
                'owned_by_me' => ($owners[$bp->id] ?? collect())->contains($user->id),
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
