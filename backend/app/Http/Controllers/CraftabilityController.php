<?php

namespace App\Http\Controllers;

use App\Models\Blueprint;
use App\Models\BlueprintOwned;
use App\Models\ResourceStack;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

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
        return \App\Support\Craftability::detail($request->user(), $blueprint);
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
                'source' => 'craft',
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
            // Link back so the Items ledger can offer undo after the modal
            // is long gone.
            $item->update(['craft_id' => $audit->id]);

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
                    $item->update(['quantity' => $item->quantity - $quantity, 'craft_id' => null]);
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

    // One-time fetch of the output item's lore and stat blocks from the
    // wiki for rows the bulk item sync hasn't covered yet, cached on the row
    // ('' description marks "fetched, nothing there" so we never refetch).
    private function enrichFromWiki(Blueprint $blueprint): void
    {
        $upToDate = $blueprint->description !== null
            && ($blueprint->item_meta['stats_v'] ?? 0) >= \App\Support\WikiItem::STATS_VERSION;
        if ($upToDate || ! $blueprint->uuid) {
            return;
        }

        $data = ['description' => ''];
        try {
            $itemUuid = $blueprint->item_uuid
                ?? \Illuminate\Support\Facades\Http::acceptJson()->timeout(15)
                    ->get("https://api.star-citizen.wiki/api/v2/blueprints/{$blueprint->uuid}")
                    ->json('data.output_item_uuid');

            if ($itemUuid) {
                $item = \Illuminate\Support\Facades\Http::acceptJson()->timeout(15)
                    ->get("https://api.star-citizen.wiki/api/v2/items/{$itemUuid}")
                    ->json('data');
                if (is_array($item)) {
                    $data = \App\Support\WikiItem::attributes($item);
                }
            }
        } catch (\Throwable) {
            // Offline or wiki hiccup — leave description null to retry later.
            return;
        }

        $blueprint->update($data);
    }

    public function __invoke(Request $request)
    {
        return \App\Support\Craftability::evaluate($request->user(), [
            'search' => $request->query('search'),
            'type' => $request->query('type'),
            'grade' => $request->query('grade'),
            'all' => $request->boolean('all'),
            'craftable' => $request->boolean('craftable'),
        ]);
    }
}
