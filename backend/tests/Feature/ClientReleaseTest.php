<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ClientReleaseTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        config(['starbuddy.client_repo' => 'owner/repo']);
    }

    private function asset(string $name): array
    {
        return ['name' => $name, 'browser_download_url' => "https://github.com/owner/repo/releases/download/v1.0.6/{$name}"];
    }

    public function test_it_links_each_platform_to_its_installer(): void
    {
        Http::fake(['api.github.com/repos/owner/repo/releases/latest' => Http::response([
            'tag_name' => 'v1.0.6',
            'published_at' => '2026-11-22T10:00:00Z',
            'assets' => array_map(fn ($n) => $this->asset($n), [
                'latest.json',
                'StarBuddy-1.0.6-1.x86_64.rpm',
                'StarBuddy_1.0.6_amd64.AppImage',
                'StarBuddy_1.0.6_amd64.AppImage.sig',
                'StarBuddy_1.0.6_amd64.deb',
                'StarBuddy_1.0.6_x64-setup.exe',
                'StarBuddy_1.0.6_x64-setup.exe.sig',
                'StarBuddy_1.0.6_x64_en-US.msi',
            ]),
        ])]);

        $url = fn ($n) => "https://github.com/owner/repo/releases/download/v1.0.6/{$n}";
        $this->getJson('/api/client/latest')->assertOk()->assertExactJson([
            'version' => '1.0.6',
            'published_at' => '2026-11-22T10:00:00Z',
            'page' => 'https://github.com/owner/repo/releases/latest',
            'downloads' => [
                'windows' => $url('StarBuddy_1.0.6_x64-setup.exe'),
                'windows_msi' => $url('StarBuddy_1.0.6_x64_en-US.msi'),
                'appimage' => $url('StarBuddy_1.0.6_amd64.AppImage'),
                'deb' => $url('StarBuddy_1.0.6_amd64.deb'),
                'rpm' => $url('StarBuddy-1.0.6-1.x86_64.rpm'),
            ],
        ]);

        // Cached: a second visit doesn't ask GitHub again.
        $this->getJson('/api/client/latest')->assertOk();
        Http::assertSentCount(1);
    }

    public function test_github_down_falls_back_to_the_releases_page(): void
    {
        Http::fake(['*' => Http::response('rate limited', 403)]);

        $this->getJson('/api/client/latest')->assertOk()
            ->assertJsonPath('version', null)
            ->assertJsonPath('downloads.windows', null)
            ->assertJsonPath('page', 'https://github.com/owner/repo/releases/latest');
    }

    public function test_it_needs_no_sign_in(): void
    {
        Http::fake(['*' => Http::response(['tag_name' => 'v1.0.6', 'assets' => []])]);
        $this->getJson('/api/client/latest')->assertOk();
    }
}
