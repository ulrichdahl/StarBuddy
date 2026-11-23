<?php

namespace Tests\Feature;

use App\Models\Org;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/** A member's own data: exported as one file, or deleted with the account. */
class AccountTest extends TestCase
{
    use RefreshDatabase;

    private function member(): array
    {
        $user = User::factory()->create(['discord_id' => '300', 'handle' => 'Kestrel', 'udi_link_token' => str_repeat('a', 43)]);
        $other = User::factory()->create(['discord_id' => '301', 'handle' => 'Other']);
        $org = Org::create(['name' => 'Syndikatet']);
        $org->memberships()->attach($user->id, ['role' => 'member', 'status' => 'active']);
        $org->memberships()->attach($other->id, ['role' => 'manager', 'status' => 'active']);
        $user->createToken('Gaming PC');

        return [$user, $other, $org];
    }

    public function test_the_export_holds_the_members_data_and_no_secrets(): void
    {
        [$user] = $this->member();

        $res = $this->actingAs($user)->get('/api/me/export')->assertOk();
        $this->assertStringContainsString('attachment; filename="starbuddy-', $res->headers->get('Content-Disposition'));
        $res->assertJsonPath('account.handle', 'Kestrel')
            ->assertJsonPath('account.udi_linked', true)
            ->assertJsonPath('data.org_members.0.org_name', 'Syndikatet')
            ->assertJsonPath('data.paired_devices.0.name', 'Gaming PC');

        $body = $res->getContent();
        $this->assertStringNotContainsString(str_repeat('a', 43), $body);
        $this->assertStringNotContainsString('"password"', $body);
        $this->assertStringNotContainsString('Other', $body);
    }

    public function test_deleting_the_account_takes_its_data_and_the_udi_settings(): void
    {
        config(['starbuddy.udi_url' => 'https://udi.test']);
        Http::fake(['udi.test/*' => Http::response(null, 204)]);
        [$user, $other, $org] = $this->member();

        // Only on purpose.
        $this->actingAs($user)->deleteJson('/api/me')->assertUnprocessable();
        $this->actingAs($user)->deleteJson('/api/me', ['confirm' => 'yes'])->assertUnprocessable();
        $this->assertModelExists($user);

        $this->actingAs($user)->deleteJson('/api/me', ['confirm' => 'DELETE'])->assertNoContent();

        $this->assertModelMissing($user);
        $this->assertSame(0, DB::table('personal_access_tokens')->where('tokenable_id', $user->id)->count());
        $this->assertSame(0, DB::table('org_members')->where('user_id', $user->id)->count());
        Http::assertSent(fn ($r) => $r->method() === 'DELETE' && $r->url() === 'https://udi.test/api/starbuddy/profile');

        // Nobody else is touched.
        $this->assertModelExists($other);
        $this->assertSame(1, DB::table('org_members')->where('org_id', $org->id)->count());
    }

    public function test_an_unreachable_udi_does_not_keep_the_account(): void
    {
        config(['starbuddy.udi_url' => 'https://udi.test']);
        Http::fake(['udi.test/*' => Http::response(null, 503)]);
        [$user] = $this->member();

        $this->actingAs($user)->deleteJson('/api/me', ['confirm' => 'DELETE'])->assertNoContent();
        $this->assertModelMissing($user);
    }
}
