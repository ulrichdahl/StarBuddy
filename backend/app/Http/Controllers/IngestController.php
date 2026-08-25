<?php

namespace App\Http\Controllers;

use App\Models\BlueprintOwned;
use App\Models\RefineryOrder;
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
            'events.*.kind' => ['required', 'in:blueprint,refinery_completed'],
            'events.*.timestamp' => ['required', 'date'],
            'events.*.detail' => ['required', 'string', 'max:255'],
            'events.*.item_class' => ['nullable', 'string', 'max:255'],
        ]);

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
        $counts = ['accepted' => 0, 'duplicates' => $events->count() - $fresh->count(), 'blueprints_added' => 0, 'refinery_completed' => 0, 'backfilled' => 0];

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

        DB::transaction(function () use ($fresh, $user, $byClass, &$counts) {
            foreach ($fresh as $e) {
                DB::table('ingest_events')->insert([
                    'user_id' => $user->id,
                    'event_type' => $e['kind'],
                    'payload' => json_encode(['detail' => $e['detail'], 'item_class' => $e['item_class'] ?? null]),
                    'log_timestamp' => $e['timestamp'],
                    'fingerprint' => $e['fingerprint'],
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
                $counts['accepted']++;

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
                } else {
                    $open = RefineryOrder::where('user_id', $user->id)
                        ->where('station', $e['detail'])
                        ->whereNull('completed_at')
                        ->oldest('placed_at')
                        ->first();

                    if ($open) {
                        $open->update(['completed_at' => $e['timestamp']]);
                    } else {
                        RefineryOrder::create([
                            'user_id' => $user->id,
                            'station' => $e['detail'],
                            'completed_at' => $e['timestamp'],
                            'source' => 'log',
                        ]);
                    }
                    $counts['refinery_completed']++;
                    $this->notifyRefineryCompletion($user, $e['detail'], $e['timestamp']);
                }
            }
        });

        // Name-only rows (client couldn't resolve an item class) get the
        // full linker pass right away instead of waiting for the nightly
        // recipe sync.
        if ($counts['blueprints_added'] > 0 || $counts['backfilled'] > 0) {
            $counts['linked'] = \App\Support\BlueprintLinker::linkUnlinked($user->id);
        }

        return $counts;
    }

    // Refinery pings go to the configured channel, and only for live events:
    // a first-run logbackups import replays months of completions.
    private function notifyRefineryCompletion($user, string $station, string $timestamp): void
    {
        $channel = config('starmaker.refinery_channel_id');
        if (! $channel) {
            return;
        }
        $at = \Carbon\Carbon::parse($timestamp);
        if ($at->lt(now()->subMinutes(15))) {
            return;
        }
        \App\Jobs\NotifyDiscord::dispatch($channel, [
            'title' => 'Refinery order complete',
            'description' => sprintf('**%s** — work order at **%s** is ready for pickup.', $user->handle ?? $user->name, $station),
            'color' => 0x5BC8DB,
            'timestamp' => $at->toIso8601String(),
            'footer' => ['text' => 'StarBuddy'],
        ]);
    }
}
