<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Collection;

class OrgMembers
{
    /**
     * Active members across the viewer's orgs, the viewer included, sorted
     * by handle — the column set of every "who has it" matrix.
     */
    public static function of(User $me): Collection
    {
        return $me->orgs()->with('members:users.id,users.name,users.handle')->get()
            ->flatMap(fn ($org) => $org->members)
            ->push($me)
            ->unique('id')
            ->sortBy(fn ($u) => strtolower($u->handle ?? $u->name))
            ->values();
    }
}
