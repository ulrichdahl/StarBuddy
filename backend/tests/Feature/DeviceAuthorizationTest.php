<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DeviceAuthorizationTest extends TestCase
{
    use RefreshDatabase;

    private function start(): array
    {
        return $this->postJson('/api/devices/authorize', ['device_name' => 'Gaming PC'])->assertOk()->json();
    }

    public function test_approved_in_the_browser_the_client_gets_its_token_once(): void
    {
        config(['app.url' => 'https://starbuddy.example']);
        $start = $this->start();
        $this->assertSame(40, strlen($start['device_code']));
        $this->assertMatchesRegularExpression('/^[A-Z2-9]{4}-[A-Z2-9]{4}$/', $start['user_code']);
        $this->assertSame('https://starbuddy.example/pair?code='.$start['user_code'], $start['verification_uri_complete']);

        $this->postJson('/api/devices/token', ['device_code' => $start['device_code']])
            ->assertStatus(400)->assertJson(['error' => 'authorization_pending']);

        $me = User::factory()->create(['discord_id' => '1', 'handle' => 'Kestrel']);
        $this->actingAs($me);
        $this->getJson('/api/devices/authorize/'.strtolower(str_replace('-', '', $start['user_code'])))
            ->assertOk()->assertJson(['device_name' => 'Gaming PC', 'status' => 'pending']);
        $this->postJson("/api/devices/authorize/{$start['user_code']}", ['approve' => true])->assertOk();
        $this->postJson("/api/devices/authorize/{$start['user_code']}", ['approve' => true])->assertStatus(409);

        $this->app['auth']->forgetGuards();
        $this->travel(4)->seconds();
        $token = $this->postJson('/api/devices/token', ['device_code' => $start['device_code']])
            ->assertOk()->assertJsonPath('user.handle', 'Kestrel')->json('token');

        $this->assertSame(1, $me->tokens()->count());
        $this->assertSame('Gaming PC', $me->tokens()->first()->name);
        $this->withToken($token)->getJson('/api/me')->assertOk()->assertJsonPath('id', $me->id);

        // Single use.
        $this->postJson('/api/devices/token', ['device_code' => $start['device_code']])
            ->assertStatus(400)->assertJson(['error' => 'expired_token']);
    }

    public function test_denied_in_the_browser(): void
    {
        $start = $this->start();
        $this->actingAs(User::factory()->create(['discord_id' => '1']));
        $this->postJson("/api/devices/authorize/{$start['user_code']}", ['approve' => false])->assertOk();

        $this->postJson('/api/devices/token', ['device_code' => $start['device_code']])
            ->assertStatus(400)->assertJson(['error' => 'access_denied']);
    }

    public function test_polling_too_fast_is_told_to_slow_down(): void
    {
        $start = $this->start();
        $this->postJson('/api/devices/token', ['device_code' => $start['device_code']])->assertJson(['error' => 'authorization_pending']);
        $this->postJson('/api/devices/token', ['device_code' => $start['device_code']])->assertJson(['error' => 'slow_down']);
    }

    public function test_codes_expire_after_ten_minutes(): void
    {
        $start = $this->start();
        $this->travel(11)->minutes();
        $this->postJson('/api/devices/token', ['device_code' => $start['device_code']])->assertJson(['error' => 'expired_token']);
        $this->actingAs(User::factory()->create(['discord_id' => '1']));
        $this->getJson("/api/devices/authorize/{$start['user_code']}")->assertNotFound();
    }

    public function test_approving_needs_a_signed_in_member(): void
    {
        $start = $this->start();
        $this->postJson("/api/devices/authorize/{$start['user_code']}", ['approve' => true])->assertUnauthorized();
    }
}
