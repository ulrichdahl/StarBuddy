<?php

namespace App\Http\Controllers;

use App\Models\User;

class BotController extends Controller
{
    public function health()
    {
        return ['ok' => true, 'status' => 'ok', 'time' => now()->toIso8601String()];
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
            'locale' => $user->locale,
            'orgs' => $user->orgs->pluck('name'),
        ];
    }

    // ── Org administration, driven by Discord server admins via the bot. ──
    // The bot verifies the invoking Discord member has ManageGuild before
    // calling any of these.

    public function createOrg(\Illuminate\Http\Request $request)
    {
        $data = $request->validate(['name' => ['required', 'string', 'max:100']]);
        $org = \App\Models\Org::firstOrCreate(['name' => $data['name']]);

        return response()->json(['id' => $org->id, 'name' => $org->name], $org->wasRecentlyCreated ? 201 : 200);
    }

    public function deleteOrg(string $name)
    {
        $org = \App\Models\Org::whereLike('name', $name, caseSensitive: false)->first();
        if (! $org) {
            return response()->json(['message' => "No org named \"{$name}\"."], 404);
        }
        $org->delete();

        return response()->json(['deleted' => $org->name]);
    }

    public function listOrgs()
    {
        return \App\Models\Org::withCount('members')->orderBy('name')->get()
            ->map(fn ($o) => ['id' => $o->id, 'name' => $o->name, 'members_count' => $o->members_count]);
    }

    public function setManager(\Illuminate\Http\Request $request, string $name)
    {
        $data = $request->validate([
            'discord_id' => ['required', 'string'],
            'manager' => ['required', 'boolean'],
        ]);

        $org = \App\Models\Org::whereLike('name', $name, caseSensitive: false)->first();
        if (! $org) {
            return response()->json(['message' => "No org named \"{$name}\"."], 404);
        }
        $user = User::where('discord_id', $data['discord_id'])->first();
        if (! $user) {
            return response()->json(['message' => 'That player has not signed in to StarMaker yet.'], 404);
        }

        // Managers are active members by definition.
        $org->memberships()->syncWithoutDetaching([$user->id => []]);
        $org->memberships()->updateExistingPivot($user->id, [
            'role' => $data['manager'] ? 'manager' : 'member',
            'status' => 'active',
        ]);

        return response()->json([
            'org' => $org->name,
            'member' => $user->handle ?? $user->name,
            'role' => $data['manager'] ? 'manager' : 'member',
        ]);
    }
}
