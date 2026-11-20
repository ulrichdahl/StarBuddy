<?php

namespace App\Http\Controllers;

use App\Models\BlueprintOwned;
use App\Models\BlueprintPool;
use App\Models\TrackedPool;
use Illuminate\Http\Request;

/**
 * Mission reward pools a player is farming, addressed by the pool's key.
 *
 * GET returns each tracked pool with what the player still lacks from it, so
 * a list of them reads as "what is left to fly for".
 */
class TrackedPoolController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        $tracked = TrackedPool::where('user_id', $user->id)
            ->with('pool.entries.blueprint:id,name,is_default')
            ->orderBy('created_at')
            ->get();
        $mine = BlueprintOwned::where('user_id', $user->id)->whereNotNull('blueprint_id')->pluck('blueprint_id')->all();

        return $tracked->map(function (TrackedPool $t) use ($mine) {
            $entries = $t->pool->entries;
            $owned = fn ($e) => in_array($e->blueprint_id, $mine, true) || (bool) $e->blueprint?->is_default;

            return [
                'pool_key' => $t->pool->key,
                'pool_label' => $t->pool->label(),
                'factions' => collect($t->pool->sources ?? [])->pluck('contractor')->filter()->unique()->values(),
                // Who hands it out and the missions or event tiers that do,
                // as GET /api/blueprints/{id} gives them per pool.
                'sources' => $t->pool->sources ?? [],
                'in_pool' => $entries->count(),
                'owned_in_pool' => $entries->filter($owned)->count(),
                'missing' => $entries->reject($owned)->map(fn ($e) => [
                    'blueprint_id' => $e->blueprint_id,
                    'name' => $e->blueprint?->name,
                    'key' => $e->blueprint_key,
                ])->values(),
                'tracked_at' => $t->created_at?->toIso8601String(),
            ];
        });
    }

    public function store(Request $request)
    {
        $data = $request->validate(['pool_key' => ['required', 'string', 'exists:blueprint_pools,key']]);
        $pool = BlueprintPool::where('key', $data['pool_key'])->firstOrFail();
        $tracked = TrackedPool::firstOrCreate(['user_id' => $request->user()->id, 'blueprint_pool_id' => $pool->id]);

        return response()->json(['pool_key' => $pool->key], $tracked->wasRecentlyCreated ? 201 : 200);
    }

    public function destroy(Request $request, string $poolKey)
    {
        $pool = BlueprintPool::where('key', $poolKey)->first();
        if ($pool) {
            TrackedPool::where('user_id', $request->user()->id)->where('blueprint_pool_id', $pool->id)->delete();
        }

        return response()->noContent();
    }
}
