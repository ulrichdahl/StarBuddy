<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/** The per-account link token for the UDI StarLabels/StarConfig tools. */
class UdiLinkTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_token_is_made_once_kept_secret_and_unlinked(): void
    {
        config(['starbuddy.udi_url' => 'https://udi.test', 'starbuddy.udi_public_url' => 'https://udi.example']);
        Http::fake([
            'udi.test/api/starbuddy/profile' => Http::sequence()
                ->push(['message' => 'Unknown'], 404)
                ->push(['revision' => 3, 'updated_at' => '2026-11-20T12:00:00Z', 'channel' => 'live', 'labels' => true, 'config' => false])
                ->push('', 204),
        ]);
        $me = User::factory()->create(['discord_id' => '1']);
        $this->actingAs($me);

        $this->assertFalse($this->getJson('/api/me/udi-link/status')->json('linked'));

        $token = $this->getJson('/api/me/udi-link')->assertOk()->assertHeader('Cache-Control', 'no-store, private')->json('token');
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]{43}$/', $token);
        $this->assertSame($token, $this->getJson('/api/me/udi-link')->json('token'), 'made once');
        $this->assertSame('https://udi.example/vaerktoej/star-labels', $this->getJson('/api/me/udi-link')->json('setup_url.da'));

        $this->assertStringNotContainsString($token, (string) DB::table('users')->value('udi_link_token'), 'stored encrypted');
        $this->assertArrayNotHasKey('udi_link_token', $this->getJson('/api/me')->json());

        $this->assertSame(['linked' => true, 'profile' => null, 'reachable' => true], $this->getJson('/api/me/udi-link/status')->json());
        $this->assertSame(3, $this->getJson('/api/me/udi-link/status')->json('profile.revision'));
        Http::assertSent(fn ($r) => $r->hasHeader('Authorization', "Bearer {$token}") && ! str_contains($r->url(), $token));

        $this->deleteJson('/api/me/udi-link')->assertNoContent();
        Http::assertSent(fn ($r) => $r->method() === 'DELETE');
        $this->assertNull($me->fresh()->udi_link_token);
    }

    public function test_unlink_keeps_the_token_when_udi_cannot_delete(): void
    {
        config(['starbuddy.udi_url' => 'https://udi.test']);
        Http::fake(['udi.test/*' => Http::sequence()->push(['message' => 'down'], 503)->push('', 204)]);
        $me = User::factory()->create(['discord_id' => '1']);
        $this->actingAs($me)->getJson('/api/me/udi-link')->assertOk();

        $this->deleteJson('/api/me/udi-link')->assertStatus(502)->assertJsonPath('code', 'udi_unreachable');
        $this->assertNotNull($me->fresh()->udi_link_token);

        $this->deleteJson('/api/me/udi-link')->assertNoContent();
        $this->assertNull($me->fresh()->udi_link_token);
    }

    public function test_a_clients_own_token_is_adopted_when_the_account_has_none(): void
    {
        $me = User::factory()->create(['discord_id' => '1']);
        $this->actingAs($me);
        $local = str_repeat('a', 43);

        $this->putJson('/api/me/udi-link', ['token' => 'short'])->assertUnprocessable();
        $this->putJson('/api/me/udi-link', ['token' => $local])->assertOk()->assertJsonPath('token', $local);
        $this->putJson('/api/me/udi-link', ['token' => $local])->assertOk();
        $this->putJson('/api/me/udi-link', ['token' => str_repeat('b', 43)])->assertStatus(409);
    }
}
