<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Org;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Org membership for members and managers. Orgs themselves are created and
 * deleted — and managers assigned — by Discord server admins through the
 * bot (see BotController); the website handles joining and moderation.
 */
class OrgController extends Controller
{
    /** All orgs with headline stats and the caller's membership state. */
    public function index(Request $request)
    {
        $mine = $request->user()->orgMemberships()->get()
            ->keyBy('id')
            ->map(fn ($org) => ['role' => $org->pivot->role, 'status' => $org->pivot->status]);

        return Org::withCount(['members'])->orderBy('name')->get()->map(function ($org) use ($mine) {
            $memberIds = $org->members()->pluck('users.id');

            // Pooled stock: org-visible stacks of current active members.
            $orgStats = DB::table('resource_stacks')
                ->join('resource_types', 'resource_types.id', '=', 'resource_stacks.resource_type_id')
                ->where('visibility', 'org')
                ->whereIn('user_id', $memberIds)
                ->groupBy('resource_types.unit')
                ->selectRaw('resource_types.unit, sum(quantity) as total')
                ->get();

            return [
                'id' => $org->id,
                'name' => $org->name,
                'member_count' => $org->members_count,
                'total_scu' => round(($orgStats->firstWhere('unit', 'mscu')->total ?? 0) / 1000, 3),
                'total_pieces' => (int) ($orgStats->firstWhere('unit', 'pieces')->total ?? 0),
                'blueprint_count' => DB::table('blueprint_owned')
                    ->whereIn('user_id', $memberIds)
                    ->distinct()
                    ->count('blueprint_name'),
                'membership' => $mine[$org->id] ?? null, // {role, status} or null
            ];
        });
    }

    public function join(Request $request, Org $org)
    {
        $existing = $request->user()->orgMemberships()->where('orgs.id', $org->id)->first();
        abort_if($existing !== null, 409, 'You already have a membership or pending request.');

        $org->memberships()->attach($request->user()->id, ['role' => 'member', 'status' => 'pending']);

        return response()->json(['status' => 'pending'], 201);
    }

    public function leave(Request $request, Org $org)
    {
        $org->memberships()->detach($request->user()->id);

        return response()->noContent();
    }

    /** Manager view: every membership including pending requests. */
    public function members(Request $request, Org $org)
    {
        $this->authorizeManager($request->user(), $org);

        return $org->memberships()
            ->select('users.id', 'users.name', 'users.handle', 'users.avatar_url')
            ->orderByRaw("case when org_members.status = 'pending' then 0 else 1 end")
            ->orderBy('users.name')
            ->get()
            ->map(fn ($u) => [
                'id' => $u->id,
                'name' => $u->name,
                'handle' => $u->handle,
                'avatar_url' => $u->avatar_url,
                'role' => $u->pivot->role,
                'status' => $u->pivot->status,
            ]);
    }

    public function accept(Request $request, Org $org, User $user)
    {
        $this->authorizeManager($request->user(), $org);
        $org->memberships()->updateExistingPivot($user->id, ['status' => 'active']);

        AuditLog::create([
            'user_id' => $request->user()->id,
            'org_id' => $org->id,
            'action' => 'org.member_accepted',
            'details' => ['member' => $user->handle ?? $user->name],
        ]);

        return response()->noContent();
    }

    public function kick(Request $request, Org $org, User $user)
    {
        $this->authorizeManager($request->user(), $org);
        abort_if($user->id === $request->user()->id, 422, 'Use leave to remove yourself.');
        $org->memberships()->detach($user->id);

        AuditLog::create([
            'user_id' => $request->user()->id,
            'org_id' => $org->id,
            'action' => 'org.member_kicked',
            'details' => ['member' => $user->handle ?? $user->name],
        ]);

        return response()->noContent();
    }

    private function authorizeManager(User $actor, Org $org): void
    {
        $membership = $actor->orgs()->where('orgs.id', $org->id)->first();
        abort_unless(
            $membership && in_array($membership->pivot->role, ['manager', 'admin'], true),
            403,
            'Only org managers can moderate members.',
        );
    }
}
