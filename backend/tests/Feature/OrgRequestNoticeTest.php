<?php

namespace Tests\Feature;

use App\Jobs\NotifyDiscordUser;
use App\Models\Org;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/** Managers hear about a request to join in Discord; the player hears they are in. */
class OrgRequestNoticeTest extends TestCase
{
    use RefreshDatabase;

    public function test_managers_are_told_of_a_request_and_the_player_of_being_accepted(): void
    {
        Queue::fake();
        config(['starbuddy.bot_api_token' => 'secret', 'app.url' => 'https://starbuddy.example']);
        $boss = User::factory()->create(['discord_id' => '100', 'handle' => 'Boss', 'locale' => 'da']);
        $member = User::factory()->create(['discord_id' => '101', 'handle' => 'Plain']);
        $player = User::factory()->create(['discord_id' => '200', 'handle' => 'Newbie', 'locale' => 'en']);
        $org = Org::create(['name' => 'Syndikatet']);
        $org->memberships()->attach($boss->id, ['role' => 'manager', 'status' => 'active']);
        $org->memberships()->attach($member->id, ['role' => 'member', 'status' => 'active']);

        $this->actingAs($player)->postJson("/api/orgs/{$org->id}/join")->assertCreated();
        Queue::assertPushed(NotifyDiscordUser::class, 1);
        Queue::assertPushed(NotifyDiscordUser::class, fn ($job) => $job->discordId === '100'
            && $job->embed['title'] === 'Newbie har bedt om at blive medlem af Syndikatet');

        $this->actingAs($boss)->postJson("/api/orgs/{$org->id}/members/{$player->id}/accept")->assertNoContent();
        Queue::assertPushed(NotifyDiscordUser::class, fn ($job) => $job->discordId === '200'
            && $job->embed['title'] === 'You are in Syndikatet'
            && str_contains($job->embed['description'], 'https://starbuddy.example'));

        // Accepting again (already active) sends nothing more.
        $this->actingAs($boss)->postJson("/api/orgs/{$org->id}/members/{$player->id}/accept")->assertNoContent();
        Queue::assertPushed(NotifyDiscordUser::class, 2);
    }

    public function test_nothing_is_sent_without_the_bot(): void
    {
        Queue::fake();
        config(['starbuddy.bot_api_token' => null]);
        $boss = User::factory()->create(['discord_id' => '100']);
        $org = Org::create(['name' => 'Nordlys']);
        $org->memberships()->attach($boss->id, ['role' => 'manager', 'status' => 'active']);

        $this->actingAs(User::factory()->create(['discord_id' => '200']))->postJson("/api/orgs/{$org->id}/join")->assertCreated();
        Queue::assertNothingPushed();
    }

    public function test_managers_see_how_many_requests_wait(): void
    {
        Queue::fake();
        $boss = User::factory()->create(['discord_id' => '100']);
        $member = User::factory()->create(['discord_id' => '101']);
        $org = Org::create(['name' => 'Nordlys']);
        $org->memberships()->attach($boss->id, ['role' => 'manager', 'status' => 'active']);
        $org->memberships()->attach($member->id, ['role' => 'member', 'status' => 'active']);
        $this->actingAs(User::factory()->create(['discord_id' => '200']))->postJson("/api/orgs/{$org->id}/join")->assertCreated();

        $this->actingAs($boss)->getJson('/api/orgs')->assertOk()->assertJsonPath('0.pending_count', 1);
        $this->actingAs($member)->getJson('/api/orgs')->assertOk()->assertJsonPath('0.pending_count', null);
    }
}
