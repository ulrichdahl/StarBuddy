<?php

namespace App\Http\Controllers;

use App\Models\Blueprint;
use App\Models\BlueprintOwned;
use Illuminate\Http\Request;

class BlueprintController extends Controller
{
    public function index(Request $request)
    {
        return Blueprint::query()
            ->when($request->query('search'), fn ($q, $s) => $q->whereLike('name', "%{$s}%", caseSensitive: false))
            ->orderBy('name')
            ->limit(50)
            ->get();
    }

    // The org-wide coverage view: every org-mate's owned blueprints.
    public function owned(Request $request)
    {
        $orgUserIds = $request->user()->orgs()
            ->with('members:users.id')
            ->get()
            ->flatMap(fn ($org) => $org->members->pluck('id'))
            ->push($request->user()->id)
            ->unique();

        return BlueprintOwned::whereIn('user_id', $orgUserIds)
            ->with(['user:id,name,handle', 'blueprint'])
            ->orderBy('blueprint_name')
            ->paginate(100);
    }

    /**
     * Member × blueprint matrix: one row per recipe anyone in the member's
     * orgs owns, with the owning member ids; `members` lists the columns.
     */
    public function matrix(Request $request)
    {
        $me = $request->user();
        $members = $me->orgs()->with('members:users.id,users.name,users.handle')->get()
            ->flatMap(fn ($org) => $org->members)
            ->push($me)
            ->unique('id')
            ->sortBy(fn ($u) => strtolower($u->handle ?? $u->name))
            ->values();
        $memberIds = $members->pluck('id');

        $page = Blueprint::whereIn('id', BlueprintOwned::select('blueprint_id')->whereIn('user_id', $memberIds)->whereNotNull('blueprint_id'))
            ->orderBy('name')
            ->paginate(50);

        $owners = BlueprintOwned::whereIn('user_id', $memberIds)
            ->whereIn('blueprint_id', $page->pluck('id'))
            ->get(['blueprint_id', 'user_id'])
            ->groupBy('blueprint_id')
            ->map(fn ($rows) => $rows->pluck('user_id')->unique()->values());

        $page->setCollection($page->getCollection()->map(fn (Blueprint $b) => [
            'blueprint_id' => $b->id,
            'name' => $b->name,
            'type_display' => \App\Support\BlueprintKind::label($b),
            'owner_ids' => $owners[$b->id] ?? [],
        ]));

        return $page->toArray() + [
            'members' => $members->map(fn ($u) => ['id' => $u->id, 'handle' => $u->handle ?? $u->name])->values(),
        ];
    }

    public function storeOwned(Request $request)
    {
        $data = $request->validate([
            'blueprint_name' => ['required', 'string', 'max:255'],
            'blueprint_id' => ['nullable', 'exists:blueprints,id'],
            'acquired_at' => ['nullable', 'date'],
        ]);

        return BlueprintOwned::firstOrCreate(
            ['user_id' => $request->user()->id, 'blueprint_name' => $data['blueprint_name']],
            [...$data, 'source' => 'manual'],
        );
    }

    public function destroyOwned(Request $request, BlueprintOwned $blueprintOwned)
    {
        abort_unless($blueprintOwned->user_id === $request->user()->id, 403);
        $blueprintOwned->delete();

        return response()->noContent();
    }
}
