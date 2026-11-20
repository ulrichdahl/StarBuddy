<?php

namespace App\Http\Controllers;

use App\Jobs\NotifyDiscord;
use App\Models\Blueprint;
use App\Models\CraftTarget;
use App\Models\ResourceStack;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

/**
 * Blueprints a player has pinned to craft, and the shopping list they add up
 * to: the Gathering page on the website and in the desktop client.
 *
 * Each material counts only stock at or above the quality its recipe slot
 * asks for (the highest any pinned recipe asks, when several share it), so
 * the list says what is worth mining rather than what is merely held.
 */
class CraftTargetController extends Controller
{
    public function index(Request $request)
    {
        return $this->shoppingList($request->user());
    }

    /**
     * @return array{targets: Collection, gathering: Collection, summary: array, discord: array}
     */
    private function shoppingList(User $user): array
    {
        $targets = CraftTarget::where('user_id', $user->id)
            ->with('blueprint:id,name,item_class,ingredients,requirement_groups')
            ->orderBy('created_at')
            ->orderBy('id')
            ->get();

        $need = [];
        foreach ($targets as $target) {
            $groups = collect($target->blueprint->requirement_groups['groups'] ?? []);
            foreach ($target->blueprint->ingredients ?? [] as $ing) {
                $unit = isset($ing['quantity_mscu']) ? 'mscu' : 'pieces';
                $per = (int) ($ing['quantity_mscu'] ?? $ing['quantity_pieces'] ?? 0);
                $key = mb_strtolower($ing['name']).'|'.$unit;
                $min = $groups->first(fn ($g) => mb_strtolower((string) ($g['material'] ?? '')) === mb_strtolower($ing['name']))['min_quality'] ?? null;
                $need[$key] ??= ['name' => $ing['name'], 'unit' => $unit, 'need' => 0, 'min_quality' => null, 'for' => []];
                $need[$key]['need'] += $per * $target->quantity;
                if ($min !== null) {
                    $need[$key]['min_quality'] = max((int) $min, $need[$key]['min_quality'] ?? 0);
                }
                $need[$key]['for'][$target->blueprint_id] = [
                    'blueprint_id' => $target->blueprint_id,
                    'name' => $target->blueprint->name,
                    'quantity' => $target->quantity,
                ];
            }
        }

        $gathering = collect($need)->map(function (array $row) use ($user) {
            $floor = $row['unit'] === 'mscu' ? max(1, $row['min_quality'] ?? 1) : null;
            $mine = $this->held(ResourceStack::where('user_id', $user->id), $row['name'], $floor);
            $org = $this->held(ResourceStack::visibleTo($user), $row['name'], $floor);
            $mineAny = $floor === null ? $mine : $this->held(ResourceStack::where('user_id', $user->id), $row['name'], 0);

            return [
                'name' => $row['name'],
                'unit' => $row['unit'],
                'need' => $row['need'],
                // The quality the recipes ask for; null when they do not say.
                'min_quality' => $row['min_quality'],
                'for' => array_keys($row['for']),
                'for_targets' => array_values($row['for']),
                // Stock at or above min_quality: the player's own, and what
                // they can see (their own plus the org's shared stacks).
                'have_mine' => $mine,
                'have_org' => $org,
                // The player's own stock that is too poor to count.
                'have_mine_below' => max(0, $mineAny - $mine),
                // Still to get once the player's own stock is spent, and once
                // the org's is counted too.
                'missing' => max(0, $row['need'] - $mine),
                'missing_with_org' => max(0, $row['need'] - $org),
            ];
        })->sortBy([['missing', 'desc'], ['name', 'asc']])->values();

        $presentTargets = $targets->map(function (CraftTarget $t) use ($gathering) {
            $lines = $gathering->filter(fn ($g) => in_array($t->blueprint_id, $g['for'], true));

            return [
                'blueprint_id' => $t->blueprint_id,
                'name' => $t->blueprint->name,
                'item_class' => $t->blueprint->item_class,
                'quantity' => $t->quantity,
                'pinned_at' => $t->created_at?->toIso8601String(),
                'materials' => $lines->count(),
                'materials_missing' => $lines->where('missing', '>', 0)->count(),
                'materials_missing_with_org' => $lines->where('missing_with_org', '>', 0)->count(),
                // Everything the recipe needs is in the player's own hold.
                'ready' => $lines->where('missing', '>', 0)->isEmpty(),
            ];
        });

        return [
            'targets' => $presentTargets,
            'gathering' => $gathering,
            'summary' => [
                'materials' => $gathering->count(),
                'still_to_gather' => $gathering->where('missing', '>', 0)->count(),
                'still_to_gather_with_org' => $gathering->where('missing_with_org', '>', 0)->count(),
            ],
            'discord' => ['can_post' => (bool) config('starbuddy.gathering_channel_id')],
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

    /**
     * Post the shopping list to the org's gathering channel on Discord, so
     * org mates can see what the player is after and offer it.
     *
     * scope "mine" lists what is missing from the player's own stock; "org"
     * what is missing even counting the org's shared stock.
     */
    public function share(Request $request)
    {
        $channel = config('starbuddy.gathering_channel_id');
        abort_unless((bool) $channel, 409, 'No Discord channel is set up for shopping lists.');
        $scope = $request->validate(['scope' => ['nullable', 'in:mine,org']])['scope'] ?? 'mine';

        $user = $request->user();
        $list = $this->shoppingList($user);
        $field = $scope === 'org' ? 'missing_with_org' : 'missing';
        $lines = $list['gathering']->filter(fn ($g) => $g[$field] > 0);
        abort_if($lines->isEmpty(), 422, 'Nothing left to gather.');

        $amount = fn (array $g, int $v) => $g['unit'] === 'mscu'
            ? rtrim(rtrim(number_format($v / 1000, 2, '.', ''), '0'), '.').' SCU'
            : $v.' pcs';
        $handle = $user->handle ?? $user->name;

        NotifyDiscord::dispatch($channel, [
            'title' => "Shopping list — {$handle}",
            'description' => $lines->map(fn ($g) => sprintf(
                '**%s** — %s%s',
                $g['name'],
                $amount($g, $g[$field]),
                $g['min_quality'] ? " (quality ≥ {$g['min_quality']})" : '',
            ))->take(25)->implode("\n"),
            'footer' => ['text' => 'For: '.$list['targets']->map(fn ($t) => $t['quantity'] > 1 ? "{$t['name']} ×{$t['quantity']}" : $t['name'])->implode(', ')],
            'color' => 0x4FD1C5,
        ], $user->discord_id ? "<@{$user->discord_id}> is gathering:" : null);

        return response()->json(['posted' => $lines->count()], 202);
    }

    /** Quantity of one material in a set of stacks at or above a quality. */
    private function held($stacks, string $name, ?int $minQuality): int
    {
        return (int) $stacks
            ->whereHas('resourceType', fn ($q) => $q->whereLike('name', $name, caseSensitive: false))
            ->when($minQuality !== null, fn ($q) => $q->where('quality', '>=', $minQuality))
            ->sum('quantity');
    }
}
