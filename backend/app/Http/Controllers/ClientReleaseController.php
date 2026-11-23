<?php

namespace App\Http\Controllers;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * The latest desktop client release, so the website can link straight to
 * the installer for the visitor's platform instead of the releases page.
 * Public: the login page and the help link to it too. Read from GitHub and
 * cached, so visitors never reach GitHub's API rate limit.
 */
class ClientReleaseController extends Controller
{
    /** File name pattern per download, matched against the release's assets. */
    private const ASSETS = [
        'windows' => '/_x64-setup\.exe$/',
        'windows_msi' => '/\.msi$/',
        'appimage' => '/\.AppImage$/',
        'deb' => '/\.deb$/',
        'rpm' => '/\.rpm$/',
    ];

    public function __invoke()
    {
        $repo = (string) config('starbuddy.client_repo');
        $page = "https://github.com/{$repo}/releases/latest";

        $release = Cache::get('client-release');
        if ($release === null) {
            $release = $this->fetch($repo);
            // A failed lookup is retried sooner than a good one is refreshed.
            Cache::put('client-release', $release, now()->addMinutes($release['version'] ? 15 : 2));
        }

        return [...$release, 'page' => $page];
    }

    /** @return array{version: ?string, published_at: ?string, downloads: array<string, ?string>} */
    private function fetch(string $repo): array
    {
        $empty = ['version' => null, 'published_at' => null, 'downloads' => array_fill_keys(array_keys(self::ASSETS), null)];

        try {
            $response = Http::acceptJson()->timeout(8)->get("https://api.github.com/repos/{$repo}/releases/latest");
        } catch (\Throwable $e) {
            Log::warning('Client release lookup failed', ['error' => $e->getMessage()]);

            return $empty;
        }
        if (! $response->ok()) {
            Log::warning('Client release lookup failed', ['status' => $response->status()]);

            return $empty;
        }

        $downloads = $empty['downloads'];
        foreach ((array) $response->json('assets', []) as $asset) {
            $name = (string) ($asset['name'] ?? '');
            foreach (self::ASSETS as $key => $pattern) {
                if ($downloads[$key] === null && preg_match($pattern, $name)) {
                    $downloads[$key] = $asset['browser_download_url'] ?? null;
                }
            }
        }

        return [
            'version' => ltrim((string) $response->json('tag_name', ''), 'v') ?: null,
            'published_at' => $response->json('published_at'),
            'downloads' => $downloads,
        ];
    }
}
