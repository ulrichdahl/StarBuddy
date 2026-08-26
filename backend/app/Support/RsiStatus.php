<?php

namespace App\Support;

use App\Jobs\NotifyDiscord;
use App\Models\RsiIncident;
use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Watches status.robertsspaceindustries.com (a cstate site) and turns its
 * incident list into alerts. RSI posts a maintenance notice roughly half an
 * hour before servers go down, and that window is all players have to stow
 * ships and gear — so this runs every minute and shouts on the first sight
 * of anything new. The mirrored incidents also feed the web banner, the
 * desktop client and the bot's /starbuddy status command.
 */
class RsiStatus
{
    public const CACHE_KEY = 'rsi_status.summary';

    /** Colours for the Discord embed per cstate severity. */
    private const COLORS = [
        'down' => 0xE60000,
        'disrupted' => 0xCC4400,
        'maintenance' => 0xE0A526,
        'notice' => 0x24478F,
        'resolved' => 0x2E8B57,
    ];

    public static function baseUrl(): string
    {
        return rtrim(config('starmaker.status_url', 'https://status.robertsspaceindustries.com'), '/');
    }

    /**
     * One polling pass. Returns the alerts raised as [kind => slug] pairs
     * (kinds: new, update, resolved) so the command can log them.
     */
    public static function poll(): array
    {
        $index = Http::acceptJson()->timeout(10)->retry(2, 500)
            ->get(self::baseUrl().'/index.json')
            ->throw()
            ->json();

        if (! is_array($index) || ! isset($index['systems'])) {
            throw new \RuntimeException('Unexpected status index payload');
        }

        // The index repeats an issue under every system it affects.
        $open = [];
        foreach ($index['systems'] as $system) {
            foreach ($system['unresolvedIssues'] ?? [] as $issue) {
                $slug = self::slug($issue);
                if ($slug) {
                    $open[$slug] = $issue;
                }
            }
        }

        $alerts = [];
        $known = RsiIncident::whereIn('slug', array_keys($open))->get()->keyBy('slug');

        foreach ($open as $slug => $issue) {
            $existing = $known->get($slug);
            $lastMod = self::parseTime($issue['lastMod'] ?? null);

            // Unchanged since we last looked — skip the per-issue fetch.
            if ($existing && ! $existing->resolved && $lastMod && $existing->rsi_updated_at?->equalTo($lastMod)) {
                continue;
            }

            $detail = self::fetchIssue($slug) ?? $issue;
            $attrs = self::attributes($slug, $detail);
            $hash = self::hash($attrs);

            if (! $existing) {
                $incident = RsiIncident::create($attrs + ['body_hash' => $hash]);
                self::alert($incident, 'new');
                $alerts[] = ['new', $slug];
            } elseif ($existing->body_hash !== $hash || $existing->resolved) {
                $existing->update($attrs + ['body_hash' => $hash, 'resolved' => false, 'resolved_at' => null]);
                self::alert($existing, 'update');
                $alerts[] = ['update', $slug];
            } else {
                $existing->update(['rsi_updated_at' => $attrs['rsi_updated_at']]);
            }
        }

        // Anything we had open that RSI no longer lists is resolved.
        $gone = RsiIncident::where('resolved', false)->whereNotIn('slug', array_keys($open) ?: [''])->get();
        foreach ($gone as $incident) {
            $detail = self::fetchIssue($incident->slug);
            $resolvedAt = $detail ? self::parseTime($detail['resolvedAt'] ?? null) : null;
            $incident->update([
                'resolved' => true,
                'resolved_at' => $resolvedAt ?? now(),
                'body_html' => $detail['body'] ?? $incident->body_html,
                'rsi_updated_at' => $detail ? (self::parseTime($detail['lastMod'] ?? null) ?? $incident->rsi_updated_at) : $incident->rsi_updated_at,
            ]);
            self::alert($incident, 'resolved');
            $alerts[] = ['resolved', $incident->slug];
        }

        Cache::put(self::CACHE_KEY, [
            'summary' => $index['summaryStatus'] ?? 'unknown',
            'systems' => collect($index['systems'])->map(fn ($s) => [
                'name' => $s['name'] ?? '',
                'status' => $s['status'] ?? 'unknown',
            ])->values()->all(),
            'fetched_at' => now()->toIso8601String(),
        ], now()->addDay());

        return $alerts;
    }

    /** What the API hands to the web app, the client and the bot. */
    public static function current(): array
    {
        $summary = Cache::get(self::CACHE_KEY);

        return [
            'summary' => $summary['summary'] ?? 'unknown',
            'systems' => $summary['systems'] ?? [],
            'fetched_at' => $summary['fetched_at'] ?? null,
            'status_url' => self::baseUrl(),
            'active' => RsiIncident::where('resolved', false)->orderByDesc('started_at')->get()
                ->map->toAlert()->values()->all(),
            'recent' => RsiIncident::where('resolved', true)->where('resolved_at', '>=', now()->subHours(12))
                ->orderByDesc('resolved_at')->limit(5)->get()->map->toAlert()->values()->all(),
        ];
    }

    private static function fetchIssue(string $slug): ?array
    {
        try {
            $resp = Http::acceptJson()->timeout(10)->get(self::baseUrl()."/issues/{$slug}/index.json");
            if ($resp->status() === 404) {
                return null;
            }
            $data = $resp->throw()->json();

            return is_array($data) && isset($data['title']) ? $data : null;
        } catch (\Throwable $e) {
            Log::warning('RSI status: issue fetch failed', ['slug' => $slug, 'error' => $e->getMessage()]);

            return null;
        }
    }

    private static function attributes(string $slug, array $issue): array
    {
        return [
            'slug' => $slug,
            'title' => (string) ($issue['title'] ?? $slug),
            'severity' => strtolower((string) ($issue['severity'] ?? 'notice')),
            'informational' => (bool) ($issue['informational'] ?? false),
            'affected' => array_values(array_filter((array) ($issue['affected'] ?? []), 'is_string')),
            'body_html' => $issue['body'] ?? null,
            // Kept verbatim: the site is static S3 hosting, so the directory
            // form without index.html does not resolve.
            'permalink' => $issue['permalink'] ?? null,
            'started_at' => self::parseTime($issue['createdAt'] ?? null),
            'rsi_updated_at' => self::parseTime($issue['lastMod'] ?? null),
        ];
    }

    private static function hash(array $attrs): string
    {
        return sha1(implode('|', [
            $attrs['title'], $attrs['severity'], (int) $attrs['informational'],
            implode(',', $attrs['affected']), trim((string) $attrs['body_html']),
        ]));
    }

    private static function slug(array $issue): ?string
    {
        if (! empty($issue['filename'])) {
            return preg_replace('/\.md$/', '', basename($issue['filename']));
        }
        if (! empty($issue['permalink']) && preg_match('~/issues/([^/]+)/~', $issue['permalink'], $m)) {
            return $m[1];
        }

        return null;
    }

    /**
     * cstate timestamps look like "2026-08-26 14:15:00 +0000 UTC" or
     * "2026-08-26 10:15:09 -0400 -0400" (and "<no value>" when unset).
     */
    public static function parseTime(?string $raw): ?Carbon
    {
        if (! $raw || ! preg_match('/^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})(?:\s*([+-]\d{4}|Z))?/', trim($raw), $m)) {
            return null;
        }
        try {
            return Carbon::parse($m[1].' '.($m[2] ?? '+0000'))->utc();
        } catch (\Throwable) {
            return null;
        }
    }

    /** Markdown-ish plain text from the cstate HTML body. */
    public static function plainText(?string $html): string
    {
        if (! $html) {
            return '';
        }
        $text = preg_replace('/<!--.*?-->/s', '', $html);
        $text = preg_replace('~<(strong|b)>(.*?)</\1>~s', '**$2**', $text);
        $text = preg_replace('~</p>|<br\s*/?>|</li>~i', "\n", $text);
        $text = html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = preg_replace("/[ \t]+\n/", "\n", $text);

        return trim(preg_replace("/\n{3,}/", "\n\n", $text));
    }

    /**
     * Best-effort read of the announced shutdown time ("Servers will go
     * offline at 1445 UTC"), anchored on the notice's day.
     */
    public static function shutdownTime(?string $html, ?Carbon $startedAt): ?Carbon
    {
        $text = self::plainText($html);
        if (! preg_match('/(?:offline|shut ?down|go down|taken down)\b[^.\n]{0,40}?\b(\d{1,2}):?(\d{2})\s*UTC/i', $text, $m)
            && ! preg_match('/\b(\d{1,2}):?(\d{2})\s*UTC[^.\n]{0,40}?\b(?:offline|shut ?down)/i', $text, $m)) {
            return null;
        }
        $base = ($startedAt ?? now())->copy()->utc();
        $at = $base->copy()->setTime((int) $m[1], (int) $m[2], 0);
        if ($at->lt($base->copy()->subHour())) {
            $at->addDay();
        }

        return $at;
    }

    private static function alert(RsiIncident $incident, string $kind): void
    {
        $channel = config('starmaker.status_channel_id');
        if (! $channel) {
            return;
        }

        $severity = $kind === 'resolved' ? 'resolved' : $incident->severity;
        $label = match ($severity) {
            'down' => 'Outage',
            'disrupted' => 'Degraded service',
            'maintenance' => 'Maintenance',
            'resolved' => 'Resolved',
            default => 'Notice',
        };
        $prefix = match ($kind) {
            'new' => '',
            'update' => 'Update: ',
            'resolved' => 'Resolved: ',
        };

        $body = self::plainText($incident->body_html);
        if (mb_strlen($body) > 1800) {
            $body = mb_substr($body, 0, 1800).'…';
        }
        $shutdown = self::shutdownTime($incident->body_html, $incident->started_at);

        $embed = [
            'title' => "{$prefix}{$label} — {$incident->title}",
            'url' => $incident->permalink,
            'description' => $body !== '' ? $body : $incident->title,
            'color' => self::COLORS[$severity] ?? self::COLORS['notice'],
            'fields' => array_values(array_filter([
                $incident->affected ? ['name' => 'Affected', 'value' => implode(', ', $incident->affected), 'inline' => true] : null,
                $shutdown && $kind !== 'resolved' ? ['name' => 'Servers offline', 'value' => "<t:{$shutdown->timestamp}:t> (<t:{$shutdown->timestamp}:R>)", 'inline' => true] : null,
            ])),
            'timestamp' => ($incident->rsi_updated_at ?? now())->toIso8601String(),
            'footer' => ['text' => 'StarBuddy · status.robertsspaceindustries.com'],
        ];

        // Only a fresh, player-affecting notice pings people; updates and
        // the all-clear post quietly.
        $mention = trim((string) config('starmaker.status_mention'));
        $content = ($kind === 'new' && ! $incident->informational && $mention !== '') ? $mention : null;

        NotifyDiscord::dispatch($channel, $embed, $content);
    }
}
