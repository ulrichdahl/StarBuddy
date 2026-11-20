<?php

namespace App\Support;

use App\Models\Org;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The org leaderboard on the dashboard: how orgs compare on blueprints
 * learned, missions completed and resources pooled, and an overall score.
 *
 * Every figure counts the org's current active members only, so a pilot who
 * moves org takes their record with them. A window limits each metric to what
 * happened inside it:
 *
 *  - blueprints: distinct blueprints members learned in the window;
 *  - missions: mission_completed events the desktop client sent;
 *  - resources: SCU of org-visible stacks created in the window. Stacks are
 *    edited in place, so "this month" is what was added, not what is held.
 *
 * The overall score is each metric as a share of that metric's leader, times
 * 1000, summed: an org leading all three scores 3000.
 */
class OrgCompetition
{
    public const METRICS = ['blueprints', 'missions', 'resources_scu'];

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

        $blueprints = self::blueprintsPerOrg($from, $to);
        $missions = self::missionsPerOrg($from, $to);
        $resources = self::resourcesPerOrg($from, $to);

        $rows = $orgs->map(fn (Org $org) => [
            'id' => $org->id,
            'name' => $org->name,
            'sid' => $org->sid,
            'member_count' => $members->where('org_id', $org->id)->count(),
            'blueprints' => (int) ($blueprints[$org->id] ?? 0),
            'missions' => (int) ($missions[$org->id] ?? 0),
            'resources_scu' => round(($resources[$org->id] ?? 0) / 1000, 3),
        ]);

        $leaders = collect(self::METRICS)->mapWithKeys(fn ($m) => [$m => $rows->max($m) ?: 0]);
        $rows = $rows->map(fn ($row) => [
            ...$row,
            'score' => (int) round(collect(self::METRICS)->sum(
                fn ($m) => $leaders[$m] > 0 ? $row[$m] / $leaders[$m] * 1000 : 0
            )),
        ]);

        // Ties share a rank; the next org takes the rank after them (1, 1, 3).
        $ranks = [];
        foreach ([...self::METRICS, 'score'] as $metric) {
            $sorted = $rows->sortByDesc($metric)->values();
            $rank = 0;
            $previous = null;
            foreach ($sorted as $i => $row) {
                if ($row[$metric] !== $previous) {
                    $rank = $i + 1;
                    $previous = $row[$metric];
                }
                $ranks[$row['id']][$metric === 'score' ? 'overall' : $metric] = $rank;
            }
        }

        return $rows
            ->map(fn ($row) => [...$row, 'rank' => $ranks[$row['id']]])
            ->sortBy([['score', 'desc'], ['name', 'asc']])
            ->values();
    }

    /** @return array<int, int> org id => distinct blueprints learned */
    private static function blueprintsPerOrg(?CarbonImmutable $from, CarbonImmutable $to): array
    {
        $learned = DB::raw('COALESCE(blueprint_owned.acquired_at, blueprint_owned.created_at)');

        return self::perOrg('blueprint_owned')
            ->when($from, fn ($q) => $q->where($learned, '>=', $from))
            ->where($learned, '<', $to)
            ->selectRaw('org_members.org_id, count(distinct blueprint_owned.blueprint_name) as total')
            ->pluck('total', 'org_id')
            ->all();
    }

    /** @return array<int, int> org id => missions completed */
    private static function missionsPerOrg(?CarbonImmutable $from, CarbonImmutable $to): array
    {
        return self::perOrg('ingest_events')
            ->where('ingest_events.event_type', 'mission_completed')
            ->when($from, fn ($q) => $q->where('ingest_events.log_timestamp', '>=', $from))
            ->where('ingest_events.log_timestamp', '<', $to)
            ->selectRaw('org_members.org_id, count(*) as total')
            ->pluck('total', 'org_id')
            ->all();
    }

    /** @return array<int, int> org id => mSCU in org-visible stacks */
    private static function resourcesPerOrg(?CarbonImmutable $from, CarbonImmutable $to): array
    {
        return self::perOrg('resource_stacks')
            ->join('resource_types', 'resource_types.id', '=', 'resource_stacks.resource_type_id')
            ->where('resource_types.unit', 'mscu')
            ->where('resource_stacks.visibility', 'org')
            ->when($from, fn ($q) => $q->where('resource_stacks.created_at', '>=', $from))
            ->where('resource_stacks.created_at', '<', $to)
            ->selectRaw('org_members.org_id, sum(resource_stacks.quantity) as total')
            ->pluck('total', 'org_id')
            ->all();
    }

    /** A per-user table joined to the orgs its user is an active member of. */
    private static function perOrg(string $table)
    {
        return DB::table($table)
            ->join('org_members', 'org_members.user_id', '=', "{$table}.user_id")
            ->where('org_members.status', 'active')
            ->groupBy('org_members.org_id');
    }

    /**
     * One member's own share of their org's figures in the same window.
     *
     * @return array<string, float|int>
     */
    public static function mine(int $userId, ?CarbonImmutable $from, CarbonImmutable $to): array
    {
        $learned = DB::raw('COALESCE(acquired_at, created_at)');

        return [
            'blueprints' => (int) DB::table('blueprint_owned')
                ->where('user_id', $userId)
                ->when($from, fn ($q) => $q->where($learned, '>=', $from))
                ->where($learned, '<', $to)
                ->distinct()
                ->count('blueprint_name'),
            'missions' => DB::table('ingest_events')
                ->where('user_id', $userId)
                ->where('event_type', 'mission_completed')
                ->when($from, fn ($q) => $q->where('log_timestamp', '>=', $from))
                ->where('log_timestamp', '<', $to)
                ->count(),
            'resources_scu' => round((int) DB::table('resource_stacks')
                ->join('resource_types', 'resource_types.id', '=', 'resource_stacks.resource_type_id')
                ->where('resource_stacks.user_id', $userId)
                ->where('resource_types.unit', 'mscu')
                ->where('resource_stacks.visibility', 'org')
                ->when($from, fn ($q) => $q->where('resource_stacks.created_at', '>=', $from))
                ->where('resource_stacks.created_at', '<', $to)
                ->sum('resource_stacks.quantity') / 1000, 3),
        ];
    }
}
