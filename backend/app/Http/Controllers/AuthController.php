<?php

namespace App\Http\Controllers;

use App\Models\Org;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\InvalidStateException;

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
        // Discord sends the player back with ?error= when they cancel or it
        // refuses the request.
        if ($request->filled('error')) {
            Log::notice('Sign-in stopped at Discord', [
                'error' => $request->string('error')->limit(100)->toString(),
                'description' => $request->string('error_description')->limit(200)->toString(),
            ]);

            return redirect('/?error=failed');
        }

        try {
            $discordUser = Socialite::driver('discord')->user();
        } catch (InvalidStateException) {
            // The browser came back without the session that started the
            // sign-in: an old tab, the Back button, or blocked cookies.
            Log::notice('Sign-in failed: the session did not match the sign-in it started');

            return redirect('/?error=failed');
        } catch (\Throwable $e) {
            // Usually a code used twice. The message names the request and
            // Discord's answer, never the secret or the code.
            Log::warning('Sign-in failed at Discord', ['error' => get_class($e).': '.mb_substr($e->getMessage(), 0, 300)]);

            return redirect('/?error=failed');
        }

        // The join gate: only members of this instance's home guild may sign
        // in. Asked of the home guild itself, which answers for anyone; the
        // list of a player's guilds stops at 200.
        $homeGuild = (string) config('starbuddy.home_guild_id');
        $member = Http::withToken($discordUser->token)
            ->acceptJson()
            ->get("https://discord.com/api/users/@me/guilds/{$homeGuild}/member");
        $isMember = $member->successful()
            || ($member->status() !== 404 && Http::withToken($discordUser->token)
                ->acceptJson()
                ->get('https://discord.com/api/users/@me/guilds')
                ->collect()
                ->contains(fn ($g) => (string) ($g['id'] ?? '') === $homeGuild));

        if (! $isMember) {
            Log::notice('Sign-in refused: not a member of the home guild', [
                'discord_id' => $discordUser->getId(),
                'discord_username' => $discordUser->getNickname() ?? $discordUser->getName(),
                'status' => $member->status(),
            ]);

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

        // The member's roles in the home guild: they gate features and map
        // onto orgs. Roles we cannot read (no guilds.members.read consent)
        // leave what we knew unchanged.
        if ($member->successful()) {
            $roles = array_map('strval', $member->json('roles', []));
            $user->forceFill(['discord_role_ids' => $roles])->save();
            $this->syncOrgsFromRoles($user, $roles);
        }

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
    // role_org_map.
    private function syncOrgsFromRoles(User $user, array $roles): void
    {
        $map = config('starbuddy.role_org_map');
        if (empty($map)) {
            return;
        }

        foreach ($roles as $roleId) {
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
