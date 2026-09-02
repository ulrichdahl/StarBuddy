<?php

namespace App\Http\Controllers;

use App\Models\Location;
use Illuminate\Http\Request;

class LocationController extends Controller
{
    public function index(Request $request)
    {
        // Own locations, org locations, and the shared landing zones.
        return Location::where(function ($q) use ($request) {
            $q->where('user_id', $request->user()->id)
                ->orWhereIn('org_id', $request->user()->orgs()->pluck('orgs.id'))
                ->orWhere(fn ($q) => $q->whereNull('user_id')->whereNull('org_id'));
        })
            // Not every place has a refinery, so a caller placing a refinery
            // order asks for just those.
            ->when($request->query('kind'), fn ($q, $kind) => $q->where('kind', $kind))
            ->orderBy('name')
            ->get();
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'kind' => ['sometimes', 'in:hangar,freight_elevator,landing_zone,station,ship,base,refinery,other'],
            'system' => ['nullable', 'string', 'max:255'],
            'org_id' => ['nullable', 'exists:orgs,id'],
        ]);

        $data['user_id'] = $request->user()->id;

        return Location::create($data);
    }

    public function update(Request $request, Location $location)
    {
        abort_unless($location->user_id === $request->user()->id, 403);

        $location->update($request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'kind' => ['sometimes', 'in:hangar,freight_elevator,landing_zone,station,ship,base,refinery,other'],
            'system' => ['nullable', 'string', 'max:255'],
        ]));

        return $location;
    }

    public function destroy(Request $request, Location $location)
    {
        abort_unless($location->user_id === $request->user()->id, 403);
        $location->delete();

        return response()->noContent();
    }
}
