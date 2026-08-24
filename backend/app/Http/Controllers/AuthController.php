<?php

namespace App\Http\Controllers;

use App\Models\Org;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Laravel\Socialite\Facades\Socialite;

class AuthController extends Controller
{
    public function redirect(): RedirectResponse
    {
        // identify: who you are; guilds: membership check against the home
        // guild; guilds.members.read: your roles in it, for role→org mapping.
        return Socialite::driver('discord')
            ->scopes(['identify', 'guilds', 'guilds.members.read'])
            ->redirect();
    }

    public function callback(Request $request): RedirectResponse
    {
        $discordUser = Socialite::driver('discord')->user();

        // The join gate: only members of this instance's home guild may sign in.
        $homeGuild = (string) config('starmaker.home_guild_id');
        $guilds = Http::withToken($discordUser->token)
            ->acceptJson()
            ->get('https://discord.com/api/users/@me/guilds')
            ->collect();

        if (! $guilds->contains(fn ($g) => (string) ($g['id'] ?? '') === $homeGuild)) {
            return redirect('/?error=not_a_member');
        }

        $user = User::updateOrCreate(
            ['discord_id' => $discordUser->getId()],
            [
                'name' => $discordUser->getNickname() ?? $discordUser->getName(),
                'discord_username' => $discordUser->getNickname() ?? $discordUser->getName(),
                'avatar_url' => $discordUser->getAvatar(),
            ],
        );

        $this->syncOrgsFromRoles($user, $discordUser->token, $homeGuild);

        Auth::login($user, remember: true);
        $request->session()->regenerate();

        return redirect('/');
    }

    public function logout(Request $request): RedirectResponse
    {
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect('/');
    }

    // Map the member's roles in the home guild onto orgs, per config
    // role_org_map. Roles we cannot read (no guilds.members.read consent or
    // missing scope) simply leave memberships unchanged.
    private function syncOrgsFromRoles(User $user, string $token, string $homeGuild): void
    {
        $map = config('starmaker.role_org_map');
        if (empty($map)) {
            return;
        }

        $member = Http::withToken($token)
            ->acceptJson()
            ->get("https://discord.com/api/users/@me/guilds/{$homeGuild}/member");

        if (! $member->successful()) {
            return;
        }

        foreach ($member->json('roles', []) as $roleId) {
            if (isset($map[$roleId])) {
                $org = Org::firstOrCreate(
                    ['name' => $map[$roleId]],
                    ['discord_role_id' => $roleId],
                );
                $org->members()->syncWithoutDetaching([$user->id]);
            }
        }
    }
}
