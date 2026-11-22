<?php

namespace App\Http\Controllers;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * What the sign-in page needs to know about this instance. Public. The
 * home Discord server's name and icon come from Discord: through the bot
 * when it is set up, else from the public invite lookup. Cached for a day.
 */
class InstanceController extends Controller
{
    public function __invoke()
    {
        $invite = (string) config('starbuddy.discord_invite');
        $code = preg_match('#^https://(?:discord\.gg|discord\.com/invite)/([A-Za-z0-9-]+)/?$#', $invite, $m) ? $m[1] : null;

        return [
            'discord_invite' => $code ? $invite : null,
            'discord_server' => $this->fromBot() ?? ($code ? $this->fromInvite($code) : null),
        ];
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
