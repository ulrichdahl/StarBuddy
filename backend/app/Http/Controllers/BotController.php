<?php

namespace App\Http\Controllers;

use App\Models\User;

class BotController extends Controller
{
    public function health()
    {
        return ['status' => 'ok', 'time' => now()->toIso8601String()];
    }

    public function member(string $discordId)
    {
        $user = User::where('discord_id', $discordId)->with('orgs:id,name')->first();

        if (! $user) {
            return response()->json(['registered' => false], 404);
        }

        return [
            'registered' => true,
            'name' => $user->name,
            'handle' => $user->handle,
            'orgs' => $user->orgs->pluck('name'),
        ];
    }
}
