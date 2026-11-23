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
        config(['starbuddy.discord_invite' => 'https://discord.gg/abc123', 'starbuddy.discord_bot_token' => null]);
        $this->getJson('/api/instance')->assertOk()->assertExactJson([
            'discord_invite' => 'https://discord.gg/abc123',
            'discord_server' => ['name' => 'United Danes', 'icon_url' => 'https://cdn.discordapp.com/icons/42/f00d.png?size=128'],
        ]);
        $this->getJson('/api/instance')->assertOk();
        \Illuminate\Support\Facades\Http::assertSentCount(1);
    }

    public function test_instance_without_a_valid_invite(): void
    {
        config(['starbuddy.discord_invite' => 'javascript:alert(1)', 'starbuddy.discord_bot_token' => null]);
        $this->getJson('/api/instance')->assertOk()->assertExactJson(['discord_invite' => null, 'discord_server' => null]);
    }

    public function test_instance_keeps_the_invite_when_discord_does_not_answer(): void
    {
        \Illuminate\Support\Facades\Cache::flush();
        \Illuminate\Support\Facades\Http::fake(['*' => \Illuminate\Support\Facades\Http::response('', 404)]);
        config(['starbuddy.discord_invite' => 'https://discord.com/invite/gone', 'starbuddy.discord_bot_token' => null]);
        $this->getJson('/api/instance')->assertOk()->assertExactJson(['discord_invite' => 'https://discord.com/invite/gone', 'discord_server' => null]);
    }

    public function test_instance_names_the_home_server_through_the_bot_without_an_invite(): void
    {
        \Illuminate\Support\Facades\Cache::flush();
        \Illuminate\Support\Facades\Http::fake([
            'discord.com/api/v10/guilds/42' => \Illuminate\Support\Facades\Http::response(['id' => '42', 'name' => 'United Danes', 'icon' => 'a_beef', 'system_channel_id' => '7']),
            'discord.com/api/v10/channels/7/invites' => \Illuminate\Support\Facades\Http::response(['code' => 'udi42', 'max_age' => 0]),
        ]);
        config(['starbuddy.discord_invite' => 'auto', 'starbuddy.discord_bot_token' => 'bot-secret', 'starbuddy.home_guild_id' => '42']);

        $this->getJson('/api/instance')->assertOk()->assertExactJson([
            'discord_invite' => 'https://discord.gg/udi42',
            'discord_server' => ['name' => 'United Danes', 'icon_url' => 'https://cdn.discordapp.com/icons/42/a_beef.gif?size=128'],
        ]);
        \Illuminate\Support\Facades\Http::assertSent(fn ($r) => $r->hasHeader('Authorization', 'Bot bot-secret'));
        $this->assertStringNotContainsString('bot-secret', $this->getJson('/api/instance')->getContent());
    }

    public function test_without_an_invite_setting_there_is_no_join_button(): void
    {
        \Illuminate\Support\Facades\Cache::flush();
        \Illuminate\Support\Facades\Http::fake([
            'discord.com/api/v10/guilds/42' => \Illuminate\Support\Facades\Http::response(['id' => '42', 'name' => 'United Danes', 'icon' => null, 'system_channel_id' => '7']),
        ]);
        config(['starbuddy.discord_invite' => '', 'starbuddy.discord_bot_token' => 'bot-secret', 'starbuddy.home_guild_id' => '42']);

        // The server is still named; no invite is made or offered.
        $this->getJson('/api/instance')->assertOk()->assertExactJson([
            'discord_invite' => null,
            'discord_server' => ['name' => 'United Danes', 'icon_url' => null],
        ]);
        \Illuminate\Support\Facades\Http::assertNotSent(fn ($r) => str_contains($r->url(), '/invites'));
    }

    public function test_without_create_invite_permission_there_is_no_link(): void
    {
        \Illuminate\Support\Facades\Cache::flush();
        \Illuminate\Support\Facades\Http::fake([
            'discord.com/api/v10/guilds/42' => \Illuminate\Support\Facades\Http::response(['id' => '42', 'name' => 'United Danes', 'icon' => null, 'system_channel_id' => null]),
            'discord.com/api/v10/guilds/42/channels' => \Illuminate\Support\Facades\Http::response([['id' => '9', 'type' => 2, 'position' => 0], ['id' => '8', 'type' => 0, 'position' => 1]]),
            'discord.com/api/v10/channels/8/invites' => \Illuminate\Support\Facades\Http::response(['message' => 'Missing Permissions'], 403),
        ]);
        config(['starbuddy.discord_invite' => 'auto', 'starbuddy.discord_bot_token' => 'bot-secret', 'starbuddy.home_guild_id' => '42']);

        $this->getJson('/api/instance')->assertOk()
            ->assertJsonPath('discord_invite', null)
            ->assertJsonPath('discord_server.name', 'United Danes');
        // Tried once, then left alone for a while.
        $this->getJson('/api/instance')->assertOk();
        \Illuminate\Support\Facades\Http::assertSentCount(4);
    }
}
