<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\InvalidStateException;
use Laravel\Socialite\Two\User as SocialiteUser;
use Tests\TestCase;

class TesterGateTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['starbuddy.tester_role_id' => '999']);
    }

    public function test_scan_training_is_for_testers_only(): void
    {
        $tester = User::factory()->create(['discord_id' => '1']);
        $tester->forceFill(['discord_role_ids' => ['5', '999']])->save();
        $other = User::factory()->create(['discord_id' => '2']);

        $this->actingAs($other)->getJson('/api/training/labels')->assertForbidden()->assertJsonPath('code', 'tester_only');
        $this->actingAs($other)->getJson('/api/me')->assertJsonPath('is_tester', false)->assertJsonMissingPath('discord_role_ids');
        $this->actingAs($tester)->getJson('/api/training/labels')->assertOk();
        $this->actingAs($tester)->getJson('/api/me')->assertJsonPath('is_tester', true);
    }

    public function test_without_a_tester_role_everyone_is_a_tester(): void
    {
        config(['starbuddy.tester_role_id' => '']);
        $user = User::factory()->create(['discord_id' => '1']);
        $this->actingAs($user)->getJson('/api/training/labels')->assertOk();
    }

    public function test_sign_in_stores_the_guild_roles(): void
    {
        config(['starbuddy.home_guild_id' => '42']);
        $discord = (new SocialiteUser)->map(['id' => '777', 'nickname' => 'raven', 'name' => 'Raven', 'avatar' => null]);
        $discord->token = 'token';
        Socialite::shouldReceive('driver->user')->andReturn($discord);
        Http::fake([
            'discord.com/api/users/@me/guilds' => Http::response([['id' => '42']]),
            'discord.com/api/users/@me/guilds/42/member' => Http::response(['roles' => ['999', '3']]),
        ]);

        $this->get('/api/auth/discord/callback')->assertRedirect('/');

        $user = User::where('discord_id', '777')->first();
        $this->assertSame(['999', '3'], $user->discord_role_ids);
        $this->assertTrue($user->isTester());
    }

    private function discordSignIn(string $id = '777'): void
    {
        config(['starbuddy.home_guild_id' => '42']);
        $discord = (new SocialiteUser)->map(['id' => $id, 'nickname' => 'pickle', 'name' => 'Pickle', 'avatar' => null]);
        $discord->token = 'token';
        Socialite::shouldReceive('driver->user')->andReturn($discord);
    }

    public function test_a_member_in_more_than_200_guilds_still_gets_in(): void
    {
        $this->discordSignIn();
        // The guild list stops at 200 and leaves the home guild out; the home
        // guild itself says they are a member.
        Http::fake([
            'discord.com/api/users/@me/guilds/42/member' => Http::response(['roles' => []]),
            'discord.com/api/users/@me/guilds' => Http::response([['id' => '1']]),
        ]);

        $this->get('/api/auth/discord/callback')->assertRedirect('/');
        $this->assertAuthenticated();
    }

    public function test_someone_the_home_guild_does_not_know_is_refused(): void
    {
        $this->discordSignIn();
        Http::fake(['discord.com/api/users/@me/guilds/42/member' => Http::response(['message' => 'Unknown Guild', 'code' => 10004], 404)]);

        $this->get('/api/auth/discord/callback')->assertRedirect('/?error=not_a_member');
        $this->assertGuest();
    }

    public function test_a_failed_or_cancelled_sign_in_returns_to_the_login_page(): void
    {
        $this->get('/api/auth/discord/callback?error=access_denied&error_description=The+resource+owner+denied+the+request')
            ->assertRedirect('/?error=failed');

        Socialite::shouldReceive('driver->user')->andThrow(new InvalidStateException);
        $this->get('/api/auth/discord/callback?code=x&state=y')->assertRedirect('/?error=failed');
        $this->assertGuest();
    }
}
