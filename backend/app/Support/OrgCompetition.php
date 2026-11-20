<?php

namespace App\Support;

use App\Models\Org;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The org leaderboard on the dashboard, from points for Game.log activity
 * (see Scoring): missions, refinery work orders and travel.
 *
 * Points belong to the org the player was in when they earned them. An org's
 * score is its points divided by the players who scored for it in the
 * window, so a small org of active pilots can beat a large quiet one. Each
 * category ranks the same way, by points per contributing pilot.
 *
 * Refinery orders recorded in the app and SCU added to the org's stock are
 * reported beside the ranking but never count toward it: both can be typed
 * in by hand.
 */
class OrgCompetition
{
    /**
     * Standings for every org that has members, best overall first.
     *
     * @return Collection<int, array<string, mixed>>
     */
    public static function standings(?CarbonImmutable $from, CarbonImmutable $to): Collection
    {
        $members = DB::table('org_members')
            ->where('status', 'active')
            ->get(['org_id', 'user_id']);
        $orgs = Org::whereIn('id', $members->pluck('org_id')->unique())->get(['id', 'name', 'sid']);

        $points = self::window(DB::table('score_events'), 'occurred_at', $from, $to)
            ->whereNotNull('org_id')
            ->groupBy('org_id', 'kind')
            ->selectRaw('org_id, kind, sum(points) as points, count(*) as events')
            ->get()
            ->groupBy('org_id');
        $contributors = self::window(DB::table('score_events'), 'occurred_at', $from, $to)
            ->whereNotNull('org_id')
            ->where('points', '>', 0)
            ->groupBy('org_id')
            ->selectRaw('org_id, count(distinct user_id) as total')
            ->pluck('total', 'org_id');
        $orders = self::perMembers($members, self::window(DB::table('refinery_orders'), 'refinery_orders.created_at', $from, $to)
            ->selectRaw('user_id, count(*) as total')->groupBy('user_id')->pluck('total', 'user_id'));
        $scu = self::perMembers($members, self::window(DB::table('resource_stacks'), 'resource_stacks.created_at', $from, $to)
            ->join('resource_types', 'resource_types.id', '=', 'resource_stacks.resource_type_id')
            ->where('resource_types.unit', 'mscu')
            ->where('resource_stacks.visibility', 'org')
            ->selectRaw('resource_stacks.user_id, sum(resource_stacks.quantity) as total')
            ->groupBy('resource_stacks.user_id')
            ->pluck('total', 'user_id'));

        $rows = $orgs->map(function (Org $org) use ($members, $points, $contributors, $orders, $scu) {
            $pilots = (int) ($contributors[$org->id] ?? 0);
            $byKind = collect($points[$org->id] ?? [])->keyBy('kind');
            $kinds = collect(Scoring::KINDS)->mapWithKeys(function ($kind) use ($byKind, $pilots) {
                $p = (int) ($byKind[$kind]->points ?? 0);

                return [$kind => [
                    'points' => $p,
                    'per_pilot' => $pilots > 0 ? (int) round($p / $pilots) : 0,
                    'events' => (int) ($byKind[$kind]->events ?? 0),
                ]];
            });
            $total = $kinds->sum('points');

            return [
                'id' => $org->id,
                'name' => $org->name,
                'sid' => $org->sid,
                'member_count' => $members->where('org_id', $org->id)->count(),
                'contributors' => $pilots,
                'points' => $total,
                // Points per contributing pilot: what the ranking is by.
                'score' => $pilots > 0 ? (int) round($total / $pilots) : 0,
                'kinds' => $kinds->all(),
                // Side information, typed in the app: never ranked.
                'refinery_orders' => (int) ($orders[$org->id] ?? 0),
                'resources_scu' => round(($scu[$org->id] ?? 0) / 1000, 3),
            ];
        });

        // Ties share a rank; the next org takes the rank after them (1, 1, 3).
        $ranks = [];
        $value = fn (array $row, string $metric) => $metric === 'overall' ? $row['score'] : $row['kinds'][$metric]['per_pilot'];
        foreach (['overall', ...Scoring::KINDS] as $metric) {
            $sorted = $rows->sortByDesc(fn ($row) => $value($row, $metric))->values();
            $rank = 0;
            $previous = null;
            foreach ($sorted as $i => $row) {
                if ($value($row, $metric) !== $previous) {
                    $rank = $i + 1;
                    $previous = $value($row, $metric);
                }
                $ranks[$row['id']][$metric] = $rank;
            }
        }

        return $rows
            ->map(fn ($row) => [...$row, 'rank' => $ranks[$row['id']]])
            ->sortBy([['score', 'desc'], ['name', 'asc']])
            ->values();
    }

    /**
     * One player's points for one org in the window, per category.
     *
     * @return array<string, array{points: int, events: int}>
     */
    public static function mine(int $userId, int $orgId, ?CarbonImmutable $from, CarbonImmutable $to): array
    {
        $rows = self::window(DB::table('score_events'), 'occurred_at', $from, $to)
            ->where('user_id', $userId)
            ->where('org_id', $orgId)
            ->groupBy('kind')
            ->selectRaw('kind, sum(points) as points, count(*) as events')
            ->get()
            ->keyBy('kind');

        return collect(Scoring::KINDS)->mapWithKeys(fn ($kind) => [$kind => [
            'points' => (int) ($rows[$kind]->points ?? 0),
            'events' => (int) ($rows[$kind]->events ?? 0),
        ]])->all();
    }

    /**
     * The org's current members by the points they earned for it in the
     * window, best first; members who scored nothing are listed last.
     *
     * @return Collection<int, array<string, mixed>>
     */
    public static function members(int $orgId, ?CarbonImmutable $from, CarbonImmutable $to): Collection
    {
        $users = DB::table('users')
            ->join('org_members', 'org_members.user_id', '=', 'users.id')
            ->where('org_members.org_id', $orgId)
            ->where('org_members.status', 'active')
            ->get(['users.id', 'users.name', 'users.handle', 'users.avatar_url']);
        $points = self::window(DB::table('score_events'), 'occurred_at', $from, $to)
            ->where('org_id', $orgId)
            ->whereIn('user_id', $users->pluck('id'))
            ->groupBy('user_id', 'kind')
            ->selectRaw('user_id, kind, sum(points) as points, count(*) as events')
            ->get()
            ->groupBy('user_id');

        $rows = $users->map(function ($u) use ($points) {
            $byKind = collect($points[$u->id] ?? [])->keyBy('kind');
            $kinds = collect(Scoring::KINDS)->mapWithKeys(fn ($kind) => [$kind => [
                'points' => (int) ($byKind[$kind]->points ?? 0),
                'events' => (int) ($byKind[$kind]->events ?? 0),
            ]]);

            return [
                'id' => $u->id,
                'handle' => $u->handle ?? $u->name,
                'avatar_url' => $u->avatar_url,
                'points' => $kinds->sum('points'),
                'kinds' => $kinds->all(),
            ];
        })->sortBy([['points', 'desc'], ['handle', 'asc']])->values();

        $rank = 0;
        $previous = null;

        return $rows->map(function ($row, $i) use (&$rank, &$previous) {
            if ($row['points'] !== $previous) {
                $rank = $i + 1;
                $previous = $row['points'];
            }

            return [...$row, 'rank' => $rank];
        });
    }

    private static function window($query, string $column, ?CarbonImmutable $from, CarbonImmutable $to)
    {
        return $query->when($from, fn ($q) => $q->where($column, '>=', $from))->where($column, '<', $to);
    }

    /**
     * Per-user totals summed over each org's current members.
     *
     * @return array<int, int|float>
     */
    private static function perMembers(Collection $members, Collection $perUser): array
    {
        $out = [];
        foreach ($members as $m) {
            $out[$m->org_id] = ($out[$m->org_id] ?? 0) + ($perUser[$m->user_id] ?? 0);
        }

        return $out;
    }
}
