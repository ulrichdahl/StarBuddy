<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/presence, from the desktop client: whether the game is running
 * and where the player is. Sent when the game session changes and at most
 * once a minute while it runs. share=false (a client setting) removes the
 * player's presence, so mates see nothing.
 */
class PresenceController extends Controller
{
    /** A report older than this counts as not running: a crash sends no goodbye. */
    public const STALE_SECONDS = 300;

    public function store(Request $request)
    {
        $data = $request->validate([
            'share' => ['nullable', 'boolean'],
            'running' => ['required', 'boolean'],
            'environment' => ['nullable', 'string', 'max:16'],
            'branch' => ['nullable', 'string', 'max:64'],
            'shard' => ['nullable', 'string', 'max:128'],
            'location_code' => ['nullable', 'string', 'max:128'],
            'location' => ['nullable', 'string', 'max:128'],
            'ship' => ['nullable', 'string', 'max:128'],
            'character' => ['nullable', 'array'],
            'character.geid' => ['nullable', 'string', 'max:32'],
            'character.name' => ['nullable', 'string', 'max:64'],
            'character.account_id' => ['nullable', 'string', 'max:32'],
        ]);
        $userId = $request->user()->id;

        if (($data['share'] ?? true) === false) {
            DB::table('user_presence')->where('user_id', $userId)->delete();

            return response()->noContent();
        }

        DB::table('user_presence')->updateOrInsert(['user_id' => $userId], [
            'running' => $data['running'],
            'environment' => $data['environment'] ?? null,
            'branch' => $data['branch'] ?? null,
            'shard' => $data['shard'] ?? null,
            'location_code' => $data['location_code'] ?? null,
            'location' => $data['location'] ?? null,
            'ship' => $data['ship'] ?? null,
            'character_name' => $data['character']['name'] ?? null,
            'geid' => $data['character']['geid'] ?? null,
            'account_id' => $data['character']['account_id'] ?? null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return response()->noContent();
    }

    /**
     * Presence of the given users as mates see it, keyed by user id; running
     * is false once a report is stale.
     *
     * @param  array<int>  $userIds
     * @return array<int, array<string, mixed>>
     */
    public static function of(array $userIds): array
    {
        return DB::table('user_presence')
            ->whereIn('user_id', $userIds)
            ->get()
            ->mapWithKeys(function ($p) {
                $updated = \Illuminate\Support\Carbon::parse($p->updated_at);

                return [$p->user_id => [
                    'running' => (bool) $p->running && $updated->diffInSeconds(now()) <= self::STALE_SECONDS,
                    'environment' => $p->environment,
                    'branch' => $p->branch,
                    'shard' => $p->shard,
                    'location' => $p->location,
                    'location_code' => $p->location_code,
                    'ship' => $p->ship,
                    'character_name' => $p->character_name,
                    'updated_at' => $updated->toIso8601String(),
                ]];
            })
            ->all();
    }
}
