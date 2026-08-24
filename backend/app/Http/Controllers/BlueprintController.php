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
