<?php

namespace App\Http\Controllers;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * What the sign-in page needs to know about this instance. Public. The
 * Discord server's name and icon come from Discord's public invite lookup
 * (no token needed) and are cached for a day.
 */
class InstanceController extends Controller
{
    public function __invoke()
    {
        $invite = (string) config('starbuddy.discord_invite');
        if (! preg_match('#^https://(?:discord\.gg|discord\.com/invite)/([A-Za-z0-9-]+)/?$#', $invite, $m)) {
            return ['discord_invite' => null, 'discord_server' => null];
        }

        return ['discord_invite' => $invite, 'discord_server' => $this->server($m[1])];
    }

    /** @return array{name: string, icon_url: ?string}|null */
    private function server(string $code): ?array
    {
        $cached = Cache::get("discord-invite:{$code}");
        if ($cached !== null) {
            return $cached ?: null;
        }

        $server = null;
        try {
            $response = Http::acceptJson()->timeout(6)->get("https://discord.com/api/v10/invites/{$code}");
            $guild = $response->ok() ? $response->json('guild') : null;
            if (is_array($guild) && isset($guild['id'], $guild['name'])) {
                $icon = $guild['icon'] ?? null;
                $server = [
                    'name' => (string) $guild['name'],
                    'icon_url' => $icon
                        ? sprintf('https://cdn.discordapp.com/icons/%s/%s.%s?size=128', $guild['id'], $icon, str_starts_with($icon, 'a_') ? 'gif' : 'png')
                        : null,
                ];
            } else {
                Log::warning('Discord invite lookup failed', ['status' => $response->status()]);
            }
        } catch (\Throwable $e) {
            Log::warning('Discord invite lookup failed', ['error' => $e->getMessage()]);
        }

        // A failed lookup (false) is retried sooner than a good one is refreshed.
        Cache::put("discord-invite:{$code}", $server ?? false, $server ? now()->addDay() : now()->addMinutes(10));

        return $server;
    }
}
