<?php

namespace App\Http\Controllers;

use App\Models\BlueprintOwned;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Batch ingestion of Game.log events from the desktop client. Idempotent:
 * every event is fingerprinted per user, so rescans and re-syncs are no-ops.
 */
class IngestController extends Controller
{
    public function store(Request $request)
    {
        $data = $request->validate([
            'events' => ['required', 'array', 'max:5000'],
            // refinery_completed used to arrive here from the Game.log
            // watcher. Orders are now recorded from the terminal itself, which
            // knows what is being refined rather than only that something
            // finished, so the event is accepted and ignored for older clients.
            // mission_completed feeds the org leaderboard; detail is the
            // mission's name as the log gave it.
            // quantum_arrived (detail = destination point, a Local selection
            // paired with its arrival by ship id), vehicle_released (detail =
            // ship id, from ClearDriver), location (detail = Location[...]
            // code) and jurisdiction (detail = jurisdiction name) feed the
            // points in App\Support\Scoring, as do missions and refinery
            // completions.
            'events.*.kind' => ['required', 'in:blueprint,refinery_completed,mission_completed,quantum_arrived,vehicle_released,location,jurisdiction'],
            'events.*.timestamp' => ['required', 'date'],
            'events.*.detail' => ['required', 'string', 'max:255'],
            'events.*.item_class' => ['nullable', 'string', 'max:255'],
            // The untouched log line(s), kept so points can be recounted.
            'events.*.raw' => ['nullable', 'string', 'max:4000'],
            'events.*.raw_selected' => ['nullable', 'string', 'max:4000'],
            'events.*.ship_id' => ['nullable', 'string', 'max:64'],
            'events.*.mission_id' => ['nullable', 'string', 'max:64'],
            // The character the log was written by, from the login line.
            'character' => ['nullable', 'array'],
            'character.geid' => ['nullable', 'string', 'max:32'],
            'character.name' => ['nullable', 'string', 'max:64'],
            'character.account_id' => ['nullable', 'string', 'max:32'],
        ]);
        $character = array_filter($data['character'] ?? [], fn ($v) => $v !== null && $v !== '') ?: null;
        $newAccount = \App\Support\Scoring::learnAccount($request->user()->id, $character, $request->user()->handle);

        $user = $request->user();

        $events = collect($data['events'])->map(fn ($e) => [
            ...$e,
            'fingerprint' => sha1("{$e['kind']}|{$e['timestamp']}|{$e['detail']}"),
        ])->unique('fingerprint');

        $existing = DB::table('ingest_events')
            ->where('user_id', $user->id)
            ->whereIn('fingerprint', $events->pluck('fingerprint'))
            ->pluck('fingerprint')
            ->all();

        $fresh = $events->reject(fn ($e) => in_array($e['fingerprint'], $existing, true));
        $counts = ['accepted' => 0, 'duplicates' => $events->count() - $fresh->count(), 'blueprints_added' => 0, 'refinery_completed' => 0, 'missions_completed' => 0, 'travel' => 0, 'ignored' => 0, 'backfilled' => 0, 'points' => 0];
        $orgId = \App\Support\Scoring::orgOf($user->id);

        // A re-sync after the client's name-resolution improves can carry an
        // item_class the stored row lacks — backfill instead of discarding.
        $byClass = \App\Models\Blueprint::whereNotNull('item_class')
            ->pluck('id', 'item_class')
            ->mapWithKeys(fn ($id, $class) => [\App\Models\Blueprint::normalizeClass($class) => $id]);

        foreach ($events->diffKeys($fresh) as $e) {
            if ($e['kind'] !== 'blueprint' || empty($e['item_class'])) {
                continue;
            }
            $row = BlueprintOwned::where('user_id', $user->id)
                ->where('blueprint_name', $e['detail'])
                ->whereNull('item_class')
                ->first();
            if ($row) {
                $row->update([
                    'item_class' => $e['item_class'],
                    'blueprint_id' => $row->blueprint_id ?? $byClass[\App\Models\Blueprint::normalizeClass($e['item_class'])] ?? null,
                ]);
                $counts['backfilled']++;
            }
        }

        DB::transaction(function () use ($fresh, $user, $byClass, $character, $orgId, &$counts) {
            foreach ($fresh->sortBy('timestamp') as $e) {
                $payload = array_filter([
                    'detail' => $e['detail'],
                    'item_class' => $e['item_class'] ?? null,
                    'raw' => $e['raw'] ?? null,
                    'raw_selected' => $e['raw_selected'] ?? null,
                    'ship_id' => $e['ship_id'] ?? null,
                    'mission_id' => $e['mission_id'] ?? null,
                    'character' => $character,
                ], fn ($v, $k) => $v !== null || in_array($k, ['detail', 'item_class'], true), ARRAY_FILTER_USE_BOTH);
                $id = DB::table('ingest_events')->insertGetId([
                    'user_id' => $user->id,
                    'event_type' => $e['kind'],
                    'payload' => json_encode($payload),
                    'log_timestamp' => $e['timestamp'],
                    'fingerprint' => $e['fingerprint'],
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
                $counts['accepted']++;

                $stored = DB::table('ingest_events')->find($id);
                \App\Support\Scoring::score($stored, $orgId, $user->handle);
                $counts['points'] += (int) DB::table('score_events')->where('ingest_event_id', $id)->value('points');

                if ($e['kind'] === 'blueprint') {
                    // Identity is the item class when the client resolved one;
                    // the localized display name is only a fallback key.
                    $keys = ($e['item_class'] ?? null)
                        ? ['user_id' => $user->id, 'item_class' => $e['item_class']]
                        : ['user_id' => $user->id, 'blueprint_name' => $e['detail']];

                    $owned = BlueprintOwned::firstOrCreate($keys, [
                        'blueprint_name' => $e['detail'],
                        'item_class' => $e['item_class'] ?? null,
                        'blueprint_id' => isset($e['item_class'])
                            ? $byClass[\App\Models\Blueprint::normalizeClass($e['item_class'])] ?? null
                            : null,
                        'acquired_at' => $e['timestamp'],
                        'source' => 'log',
                    ]);
                    if ($owned->wasRecentlyCreated) {
                        $counts['blueprints_added']++;
                    }
                } elseif ($e['kind'] === 'mission_completed') {
                    // The stored event is the record; the leaderboard counts them.
                    $counts['missions_completed']++;
                } elseif ($e['kind'] === 'refinery_completed') {
                    // Scores as a finished work order, but no order is
                    // invented from it: the terminal records those.
                    $counts['refinery_completed']++;
                } elseif ($e['kind'] === 'vehicle_released') {
                    // Only stored: it ties a ship to the player's own geid.
                    $counts['ignored']++;
                } else {
                    $counts['travel']++;
                }
            }
        });

        // A newly recognised game account makes the player's earlier events
        // from its other characters count.
        if ($newAccount) {
            \App\Support\Scoring::recount($user->id);
        }

        // Name-only rows (client couldn't resolve an item class) get the
        // full linker pass right away instead of waiting for the nightly
        // recipe sync.
        if ($counts['blueprints_added'] > 0 || $counts['backfilled'] > 0) {
            $counts['linked'] = \App\Support\BlueprintLinker::linkUnlinked($user->id);
        }

        return $counts;
    }

}
