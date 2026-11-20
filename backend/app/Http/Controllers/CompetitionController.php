<?php

namespace App\Http\Controllers;

use App\Support\OrgCompetition;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;

/**
 * GET /api/dashboard/competition?period=month|all
 *
 * Shape per org: id, name, sid, member_count, contributors, points, score
 * (points per contributing pilot), kinds {mission|refinery|travel:
 * {points, per_pilot, events}}, refinery_orders and resources_scu (side
 * information, unranked), rank {overall, mission, refinery, travel}, trend.
 *
 * The org leaderboard (see OrgCompetition) with each org's rank change and
 * the caller's own share of their org's figures. "month" is the calendar
 * month so far, compared with the whole of last month; "all" is all time,
 * compared with a week ago.
 */
class CompetitionController extends Controller
{
    public function __invoke(Request $request)
    {
        $period = $request->validate(['period' => ['nullable', 'in:month,all']])['period'] ?? 'month';
        $now = CarbonImmutable::now();

        if ($period === 'month') {
            $from = $now->startOfMonth();
            [$prevFrom, $prevTo] = [$from->subMonthNoOverflow(), $from];
        } else {
            $from = null;
            [$prevFrom, $prevTo] = [null, $now->subWeek()];
        }

        $standings = OrgCompetition::standings($from, $now);
        $before = OrgCompetition::standings($prevFrom, $prevTo)->keyBy('id');

        $user = $request->user();
        $myOrg = $user->orgs()->orderBy('orgs.id')->first();

        $orgs = $standings->map(fn ($row) => [
            ...$row,
            // Places climbed since the comparison window; null for an org
            // that had no members then.
            'trend' => isset($before[$row['id']])
                ? $before[$row['id']]['rank']['overall'] - $row['rank']['overall']
                : null,
            'mine' => $myOrg !== null && $row['id'] === $myOrg->id,
        ]);

        $contribution = null;
        if ($myOrg !== null) {
            $mine = OrgCompetition::mine($user->id, $myOrg->id, $from, $now);
            $org = $orgs->firstWhere('id', $myOrg->id);
            $contribution = collect(\App\Support\Scoring::KINDS)->mapWithKeys(fn ($kind) => [
                $kind => ['mine' => $mine[$kind]['points'], 'org' => $org['kinds'][$kind]['points'] ?? 0],
            ]);
        }

        return [
            'period' => $period,
            'from' => $from?->toIso8601String(),
            'to' => $now->toIso8601String(),
            'my_org_id' => $myOrg?->id,
            'orgs' => $orgs->values(),
            'contribution' => $contribution,
        ];
    }

    /**
     * GET /api/dashboard/members?period=month|all
     *
     * The caller's org's own members by the points they earned for it.
     * Only for that org's members; other orgs see only the org totals.
     */
    public function members(Request $request)
    {
        $period = $request->validate(['period' => ['nullable', 'in:month,all']])['period'] ?? 'month';
        $now = CarbonImmutable::now();
        $from = $period === 'month' ? $now->startOfMonth() : null;
        $myOrg = $request->user()->orgs()->orderBy('orgs.id')->first();

        return [
            'period' => $period,
            'org_id' => $myOrg?->id,
            'members' => $myOrg ? OrgCompetition::members($myOrg->id, $from, $now) : [],
        ];
    }
}
