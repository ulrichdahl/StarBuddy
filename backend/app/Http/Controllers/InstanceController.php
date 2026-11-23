<?php

namespace App\Http\Controllers;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * What the sign-in page needs to know about this instance. Public. The
 * home Discord server's name and icon come from Discord: through the bot
 * when it is set up, else from the public invite lookup. Cached for a day.
 * The join button is opt-in: STARBUDDY_DISCORD_INVITE is an invite URL, or
 * "auto" for one the bot makes. Empty, the sign-in page offers no invite.
 */
class InstanceController extends Controller
{
    public function __invoke()
    {
        $invite = (string) config('starbuddy.discord_invite');
        $code = preg_match('#^https://(?:discord\.gg|discord\.com/invite)/([A-Za-z0-9-]+)/?$#', $invite, $m) ? $m[1] : null;

        return [
            'discord_invite' => $code ? $invite : (strtolower(trim($invite)) === 'auto' ? $this->inviteFromBot() : null),
            'discord_server' => $this->fromBot() ?? ($code ? $this->fromInvite($code) : null),
        ];
    }

    /**
     * With STARBUDDY_DISCORD_INVITE=auto, the bot makes one: permanent, in the
     * server's welcome channel (or its first text channel). unique=false
     * hands back the same invite each time rather than piling up new ones.
     * Needs the bot's Create Invite permission; without it there is no link.
     */
    private function inviteFromBot(): ?string
    {
        $token = config('starbuddy.discord_bot_token');
        $guild = config('starbuddy.home_guild_id');
        if (! $token || ! $guild) {
            return null;
        }
        $key = "discord-bot-invite:{$guild}";
        $cached = Cache::get($key);
        if ($cached !== null) {
            return $cached ?: null;
        }

        $url = null;
        try {
            $http = fn () => Http::acceptJson()->timeout(6)->withHeaders(['Authorization' => "Bot {$token}"]);
            $base = 'https://discord.com/api/v10';
            $channel = $http()->get("{$base}/guilds/{$guild}")->json('system_channel_id');
            if (! $channel) {
                $channel = collect((array) $http()->get("{$base}/guilds/{$guild}/channels")->json())
                    ->where('type', 0)
                    ->sortBy('position')
                    ->first()['id'] ?? null;
            }
            if ($channel) {
                $response = $http()->post("{$base}/channels/{$channel}/invites", ['max_age' => 0, 'max_uses' => 0, 'unique' => false]);
                $inviteCode = $response->json('code');
                if ($response->ok() && is_string($inviteCode) && preg_match('/^[A-Za-z0-9-]+$/', $inviteCode)) {
                    $url = "https://discord.gg/{$inviteCode}";
                } else {
                    Log::warning('Bot could not create an invite', ['status' => $response->status()]);
                }
            }
        } catch (\Throwable $e) {
            Log::warning('Bot could not create an invite', ['error' => $e->getMessage()]);
        }

        Cache::put($key, $url ?? false, $url ? now()->addWeek() : now()->addMinutes(10));

        return $url;
    }

    /** @return array{name: string, icon_url: ?string}|null */
    private function fromBot(): ?array
    {
        $token = config('starbuddy.discord_bot_token');
        $guild = config('starbuddy.home_guild_id');
        if (! $token || ! $guild) {
            return null;
        }

        return $this->cached("discord-guild:{$guild}", fn () => Http::acceptJson()->timeout(6)
            ->withHeaders(['Authorization' => "Bot {$token}"])
            ->get("https://discord.com/api/v10/guilds/{$guild}")
            ->json());
    }

    /** @return array{name: string, icon_url: ?string}|null */
    private function fromInvite(string $code): ?array
    {
        return $this->cached("discord-invite:{$code}", fn () => Http::acceptJson()->timeout(6)
            ->get("https://discord.com/api/v10/invites/{$code}")
            ->json('guild'));
    }

    /**
     * @param  callable(): mixed  $lookup  returns Discord's guild object
     * @return array{name: string, icon_url: ?string}|null
     */
    private function cached(string $key, callable $lookup): ?array
    {
        $cached = Cache::get($key);
        if ($cached !== null) {
            return $cached ?: null;
        }

        $server = null;
        try {
            $guild = $lookup();
            if (is_array($guild) && isset($guild['id'], $guild['name'])) {
                $icon = $guild['icon'] ?? null;
                $server = [
                    'name' => (string) $guild['name'],
                    'icon_url' => $icon
                        ? sprintf('https://cdn.discordapp.com/icons/%s/%s.%s?size=128', $guild['id'], $icon, str_starts_with($icon, 'a_') ? 'gif' : 'png')
                        : null,
                ];
            } else {
                Log::warning('Discord server lookup failed', ['key' => $key]);
            }
        } catch (\Throwable $e) {
            Log::warning('Discord server lookup failed', ['key' => $key, 'error' => $e->getMessage()]);
        }

        // A failed lookup (false) is retried sooner than a good one is refreshed.
        Cache::put($key, $server ?? false, $server ? now()->addDay() : now()->addMinutes(10));

        return $server;
    }
}
