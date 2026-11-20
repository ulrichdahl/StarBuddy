<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Turns stored Game.log events (ingest_events) into points (score_events),
 * by the rules in config/scoring.php. Only what the game itself wrote
 * counts; nothing a player can type into the app does.
 *
 *  - mission_completed: a flat amount per contract, repeats included;
 *  - refinery_completed: a flat amount per finished work order;
 *  - quantum_arrived, location: a place, once per player per month, more
 *    for places further out (Stanton, Nyx, Pyro);
 *  - jurisdiction: entering one, once per player per month.
 *
 * Each row keeps the org the player was in when it was first scored, so a
 * recount never moves points to the player's new org.
 */
class Scoring
{
    /** Ingest kinds that can score. */
    public const SOURCES = ['mission_completed', 'refinery_completed', 'quantum_arrived', 'location', 'jurisdiction'];

    /** The leaderboard categories, in display order. */
    public const KINDS = ['mission', 'refinery', 'travel'];

    /**
     * Score one stored event, if it scores. $orgId is the org to credit when
     * the event has not been scored before.
     */
    public static function score(object $event, ?int $orgId, ?string $handle): void
    {
        $row = self::evaluate($event, $handle);
        $existing = DB::table('score_events')->where('ingest_event_id', $event->id)->first();

        if ($row === null) {
            if ($existing) {
                DB::table('score_events')->where('id', $existing->id)->delete();
            }

            return;
        }

        // A place already scored this month by the same player scores nothing.
        if ($row['place'] !== null) {
            $month = CarbonImmutable::parse($row['occurred_at'])->startOfMonth();
            $taken = DB::table('score_events')
                ->where('user_id', $event->user_id)
                ->where('place', $row['place'])
                ->where('occurred_at', '>=', $month)
                ->where('occurred_at', '<', $month->addMonth())
                ->where('ingest_event_id', '!=', $event->id)
                ->exists();
            if ($taken) {
                if ($existing) {
                    DB::table('score_events')->where('id', $existing->id)->delete();
                }

                return;
            }
        }

        $values = [
            ...$row,
            'user_id' => $event->user_id,
            'org_id' => $existing ? $existing->org_id : $orgId,
            'rules_version' => (int) config('scoring.version'),
            'updated_at' => now(),
        ];

        if ($existing) {
            DB::table('score_events')->where('id', $existing->id)->update($values);
        } else {
            DB::table('score_events')->insert([...$values, 'ingest_event_id' => $event->id, 'created_at' => now()]);
        }
    }

    /**
     * The score row an event earns by the rules, without the place-once
     * check, or null when it earns nothing.
     *
     * @return array<string, mixed>|null
     */
    public static function evaluate(object $event, ?string $handle): ?array
    {
        if (! in_array($event->event_type, self::SOURCES, true)) {
            return null;
        }
        $payload = is_string($event->payload) ? json_decode($event->payload, true) : (array) $event->payload;
        $detail = trim((string) ($payload['detail'] ?? ''));
        $character = $payload['character']['name'] ?? null;

        if (! self::isOwnCharacter($event->user_id, $payload['character'] ?? null, $handle)) {
            return null;
        }

        $points = config('scoring.points');
        [$kind, $value, $place, $system] = match ($event->event_type) {
            'mission_completed' => ['mission', $points['mission_completed'], null, null],
            'refinery_completed' => ['refinery', $points['refinery_completed'], null, null],
            'jurisdiction' => ['travel', $points['jurisdiction'], 'jurisdiction:'.mb_strtolower($detail), self::system($detail)],
            default => self::place($detail),
        };
        if ($kind === null || $detail === '') {
            return null;
        }

        return [
            'kind' => $kind,
            'source' => $event->event_type,
            'detail' => mb_substr($detail, 0, 255),
            'place' => $place,
            'system' => $system,
            'points' => (int) $value,
            'raw' => $payload['raw'] ?? null,
            'character_name' => $character,
            'occurred_at' => $event->log_timestamp,
        ];
    }

    /** @return array{0: ?string, 1: int, 2: ?string, 3: ?string} */
    private static function place(string $code): array
    {
        foreach (config('scoring.ignore_places') as $pattern) {
            if (preg_match($pattern, $code)) {
                return [null, 0, null, null];
            }
        }
        $system = self::system($code);
        $table = config('scoring.points.place');
        $key = mb_strtolower(preg_replace('/^LOC_/i', '', $code));

        return ['travel', $table[$system ?? 'default'] ?? $table['default'], 'place:'.$key, $system];
    }

    /**
     * Whether a log's character is the player's: named as their handle, or
     * on a game account such a character used. No character, or no handle
     * to compare with, passes: older clients and unset handles still score.
     */
    public static function isOwnCharacter(int $userId, ?array $character, ?string $handle): bool
    {
        $name = $character['name'] ?? null;
        if ($name === null || $handle === null || ! config('scoring.require_character_match')) {
            return true;
        }
        if (mb_strtolower($name) === mb_strtolower($handle)) {
            return true;
        }
        $account = $character['account_id'] ?? null;

        return $account !== null && DB::table('user_game_accounts')
            ->where('user_id', $userId)
            ->where('account_id', (string) $account)
            ->exists();
    }

    /**
     * Remember the game account of a character carrying the player's handle.
     * True when the account is new, so events from its other characters,
     * already stored, need scoring again.
     */
    public static function learnAccount(int $userId, ?array $character, ?string $handle): bool
    {
        $name = $character['name'] ?? null;
        $account = $character['account_id'] ?? null;
        if ($name === null || $account === null || $handle === null || mb_strtolower($name) !== mb_strtolower($handle)) {
            return false;
        }

        return DB::table('user_game_accounts')->insertOrIgnore([
            'user_id' => $userId,
            'account_id' => (string) $account,
            'created_at' => now(),
            'updated_at' => now(),
        ]) > 0;
    }

    public static function system(string $name): ?string
    {
        foreach (config('scoring.systems') as $system => $pattern) {
            if (preg_match($pattern, $name)) {
                return $system;
            }
        }

        return null;
    }

    /** The org a player's new points go to: their first active org. */
    public static function orgOf(int $userId): ?int
    {
        return DB::table('org_members')
            ->where('user_id', $userId)
            ->where('status', 'active')
            ->orderBy('org_id')
            ->value('org_id');
    }

    /**
     * Re-score every stored event in time order by the current rules.
     * Returns how many events score.
     */
    public static function recount(?int $userId = null): int
    {
        $handles = DB::table('users')->pluck('handle', 'id');
        $orgs = [];

        // Learn every account first, so a character from before the one
        // named as the handle is recognised too.
        DB::table('ingest_events')
            ->when($userId, fn ($q) => $q->where('user_id', $userId))
            ->orderBy('id')
            ->chunk(1000, function ($events) use ($handles) {
                foreach ($events as $event) {
                    $character = json_decode($event->payload, true)['character'] ?? null;
                    self::learnAccount($event->user_id, $character, $handles[$event->user_id] ?? null);
                }
            });

        DB::table('score_events')
            ->when($userId, fn ($q) => $q->where('user_id', $userId))
            ->whereNotNull('place')
            ->update(['place' => null]); // free every place before re-awarding them in order

        DB::table('ingest_events')
            ->whereIn('event_type', self::SOURCES)
            ->when($userId, fn ($q) => $q->where('user_id', $userId))
            ->orderBy('log_timestamp')
            ->orderBy('id')
            ->chunk(1000, function ($events) use ($handles, &$orgs) {
                foreach ($events as $event) {
                    $orgs[$event->user_id] ??= self::orgOf($event->user_id);
                    self::score($event, $orgs[$event->user_id], $handles[$event->user_id] ?? null);
                }
            });

        return DB::table('score_events')->when($userId, fn ($q) => $q->where('user_id', $userId))->count();
    }
}
