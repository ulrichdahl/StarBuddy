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

    /**
     * What the member's orgs can craft right now, best first — for
     * /starbuddy craftable. 404 when the Discord user isn't registered.
     */
    public function craftable(\Illuminate\Http\Request $request, string $discordId)
    {
        $user = User::where('discord_id', $discordId)->firstOrFail();
        $search = trim((string) $request->query('search'));
        $limit = max(1, min(25, (int) $request->query('limit', 10)));

        // A material name lists the craftable recipes that consume it;
        // anything else filters recipes by name.
        $material = $search !== ''
            ? \App\Models\ResourceType::whereLike('name', $search, caseSensitive: false)->value('name')
                ?? \App\Models\ResourceType::whereLike('name', "%{$search}%", caseSensitive: false)->orderByRaw('length(name)')->value('name')
            : null;

        $result = \App\Support\Craftability::evaluate($user, $material
            ? ['material' => $material, 'craftable' => true]
            : ['search' => $search ?: null, 'craftable' => true]);

        return [
            'mode' => $material ? 'material' : 'name',
            'material' => $material,
            'total' => $result['total'],
            'results' => collect($result['results'])->take($limit)->values(),
        ];
    }

    /**
     * Need-driven search for /starbuddy need: recipes matching the query
     * with blueprint holders and best material sources.
     */
    public function need(\Illuminate\Http\Request $request, string $discordId)
    {
        $user = User::where('discord_id', $discordId)->firstOrFail();
        $q = trim((string) $request->query('q'));
        abort_if($q === '', 422, 'Missing query.');

        // A category or slot ("shield", "powerplant", "undersuit") lists that
        // whole family, craftable first; anything else is a name search.
        $types = \App\Models\Blueprint::whereNotNull('ingredients')->whereNotNull('type')->distinct()->pluck('type');
        if ($category = \App\Support\BlueprintKind::matchCategory($q, $types)) {
            $result = \App\Support\Craftability::evaluate($user, ['types' => $category['types'], 'all' => true]);

            return [
                'mode' => 'category',
                'category' => $category['label'],
                'total' => $result['total'],
                'results' => collect($result['results'])->take(15)->values(),
            ];
        }

        $matches = \App\Models\Blueprint::whereNotNull('ingredients')
            ->whereLike('name', "%{$q}%", caseSensitive: false)
            ->orderByRaw('CASE WHEN lower(name) = lower(?) THEN 0 ELSE 1 END, name', [$q])
            ->limit(3)
            ->get();

        return [
            'mode' => 'name',
            'results' => $matches->map(fn ($bp) => \App\Support\Craftability::detail($user, $bp) + ['type_display' => \App\Support\BlueprintKind::label($bp)]),
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
            return response()->json(['message' => 'That player has not signed in to StarBuddy yet.'], 404);
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
