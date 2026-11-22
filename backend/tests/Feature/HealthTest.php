<?php

namespace Tests\Feature;

use Tests\TestCase;

// The SPA is served by Caddy, not Laravel, so "/" is not a Laravel route;
// /up is the uptime endpoint operators are told to monitor.
class HealthTest extends TestCase
{
    public function test_uptime_endpoint_answers(): void
    {
        $this->get('/up')->assertOk();
    }

    public function test_version_is_public(): void
    {
        config(['starbuddy.version' => '0.1.7+3 (abc1234)']);
        $this->getJson('/api/version')->assertOk()->assertJson(['name' => 'StarBuddy', 'version' => '0.1.7+3 (abc1234)']);
    }

    public function test_instance_offers_the_discord_invite_with_the_server_name_and_icon(): void
    {
        \Illuminate\Support\Facades\Cache::flush();
        \Illuminate\Support\Facades\Http::fake(['discord.com/api/v10/invites/abc123' => \Illuminate\Support\Facades\Http::response([
            'code' => 'abc123',
            'guild' => ['id' => '42', 'name' => 'United Danes', 'icon' => 'f00d'],
        ])]);
        config(['starbuddy.discord_invite' => 'https://discord.gg/abc123']);
        $this->getJson('/api/instance')->assertOk()->assertExactJson([
            'discord_invite' => 'https://discord.gg/abc123',
            'discord_server' => ['name' => 'United Danes', 'icon_url' => 'https://cdn.discordapp.com/icons/42/f00d.png?size=128'],
        ]);
        $this->getJson('/api/instance')->assertOk();
        \Illuminate\Support\Facades\Http::assertSentCount(1);
    }

    public function test_instance_without_a_valid_invite(): void
    {
        config(['starbuddy.discord_invite' => 'javascript:alert(1)']);
        $this->getJson('/api/instance')->assertOk()->assertExactJson(['discord_invite' => null, 'discord_server' => null]);
    }

    public function test_instance_keeps_the_invite_when_discord_does_not_answer(): void
    {
        \Illuminate\Support\Facades\Cache::flush();
        \Illuminate\Support\Facades\Http::fake(['*' => \Illuminate\Support\Facades\Http::response('', 404)]);
        config(['starbuddy.discord_invite' => 'https://discord.com/invite/gone']);
        $this->getJson('/api/instance')->assertOk()->assertExactJson(['discord_invite' => 'https://discord.com/invite/gone', 'discord_server' => null]);
    }
}
