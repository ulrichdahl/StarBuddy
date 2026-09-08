<?php

namespace App\Http\Controllers;

use App\Models\Location;
use Illuminate\Http\Request;

/**
 * The place catalogue: cities and stations synced from SC Trade Tools by
 * `starbuddy:sync-locations`. It is read-only to players — a location a player
 * invented would be one nobody else could file anything under, and the same
 * station typed twice would split a hold in two.
 */
class LocationController extends Controller
{
    public function index(Request $request)
    {
        // The catalogue, plus any personal or org location from before the
        // catalogue was the only source — those still hold things.
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
}
