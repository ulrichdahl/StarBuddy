<?php

namespace Tests\Feature;

use App\Jobs\NotifyDiscord;
use App\Models\RsiIncident;
use App\Support\RsiStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class RsiStatusTest extends TestCase
{
    use RefreshDatabase;

    private const BASE = 'https://status.robertsspaceindustries.com';

    /** url => payload (array) or null for 404; '/issues/*' matches any issue. */
    private array $stubs = [];

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake(function ($request) {
            $url = $request->url();
            foreach ($this->stubs as $pattern => $payload) {
                $hit = str_ends_with($pattern, '*') ? str_starts_with($url, rtrim($pattern, '*')) : $url === $pattern;
                if ($hit) {
                    return $payload === null ? Http::response('', 404) : Http::response($payload);
                }
            }

            return Http::response('', 404);
        });
    }

    private function stub(array $stubs): void
    {
        $this->stubs = $stubs;
    }

    private function issue(array $overrides = []): array
    {
        return array_merge([
            'is' => 'issue',
            'title' => 'Live Deployment',
            'createdAt' => '2026-08-26 14:15:00 +0000 UTC',
            'lastMod' => '2026-08-26 10:15:09 -0400 -0400',
            'permalink' => self::BASE.'/issues/2026-08-26_live-deployment/index.html',
            'severity' => 'maintenance',
            'resolved' => false,
            'informational' => false,
            'resolvedAt' => '<no value>',
            'affected' => ['Persistent Universe', 'Arena Commander'],
            'filename' => '2026-08-26_live-deployment.md',
        ], $overrides);
    }

    private function index(array $issues): array
    {
        return [
            'summaryStatus' => $issues ? 'maintenance' : 'ok',
            'systems' => [
                ['name' => 'Platform', 'status' => 'operational', 'unresolvedIssues' => []],
                ['name' => 'Persistent Universe', 'status' => $issues ? 'maintenance' : 'operational', 'unresolvedIssues' => $issues],
                ['name' => 'Arena Commander', 'status' => $issues ? 'maintenance' : 'operational', 'unresolvedIssues' => $issues],
            ],
        ];
    }

    private function body(string $extra = ''): string
    {
        return '<p>The Live Service is currently in maintenance to deploy Star Citizen Alpha 4.10.0.</p>'
            .'<p>Servers will go offline at 1445 UTC.</p>'
            .'<p><strong>Players are strongly advised to safely stow their vehicles and equipment before logging off in advance of server shutdown.</strong></p>'
            .'<!-- raw HTML omitted -->'.$extra;
    }

    public function test_new_incident_is_stored_and_pinged_once(): void
    {
        config(['starbuddy.status_channel_id' => '123', 'starbuddy.status_mention' => '@here']);
        Queue::fake();
        $this->stub([
            self::BASE.'/index.json' => $this->index([$this->issue()]),
            self::BASE.'/issues/2026-08-26_live-deployment/index.json' => $this->issue(['body' => $this->body()]),
        ]);

        $alerts = RsiStatus::poll();

        $this->assertSame([['new', '2026-08-26_live-deployment']], $alerts);
        $incident = RsiIncident::sole();
        $this->assertSame('maintenance', $incident->severity);
        $this->assertSame(['Persistent Universe', 'Arena Commander'], $incident->affected);
        $this->assertSame('2026-08-26 14:15:00', $incident->started_at->toDateTimeString());
        $this->assertSame('2026-08-26 14:15:09', $incident->rsi_updated_at->toDateTimeString());
        $this->assertSame(self::BASE.'/issues/2026-08-26_live-deployment/index.html', $incident->permalink);

        $this->assertCount(1, Queue::pushed(NotifyDiscord::class));
        $job = Queue::pushed(NotifyDiscord::class)->first();
        $this->assertSame('123', $job->channelId);
        $this->assertSame('@here', $job->content);
        $this->assertStringContainsString('Maintenance — Live Deployment', $job->embed['title']);
        $this->assertStringContainsString('<t:'.\Carbon\Carbon::parse('2026-08-26 14:45:00 UTC')->timestamp.':R>', $job->embed['fields'][1]['value']);

        // Same index again, unchanged lastMod: no per-issue fetch, no alert.
        $this->stub([self::BASE.'/index.json' => $this->index([$this->issue()])]);
        $this->assertSame([], RsiStatus::poll());
        $this->assertCount(1, Queue::pushed(NotifyDiscord::class));
    }

    public function test_edit_alerts_quietly_and_removal_resolves(): void
    {
        config(['starbuddy.status_channel_id' => '123', 'starbuddy.status_mention' => '@here']);
        Queue::fake();
        $this->stub([
            self::BASE.'/index.json' => $this->index([$this->issue()]),
            self::BASE.'/issues/2026-08-26_live-deployment/index.json' => $this->issue(['body' => $this->body()]),
        ]);
        RsiStatus::poll();

        // RSI appends an update line → lastMod moves, body changes.
        $edited = $this->issue(['lastMod' => '2026-08-26 10:47:00 -0400 -0400']);
        $this->stub([
            self::BASE.'/index.json' => $this->index([$edited]),
            self::BASE.'/issues/2026-08-26_live-deployment/index.json' => $edited + ['body' => $this->body('<p>1445 UTC - Servers offline.</p>')],
        ]);
        $this->assertSame([['update', '2026-08-26_live-deployment']], RsiStatus::poll());
        $update = Queue::pushed(NotifyDiscord::class)->last();
        $this->assertNull($update->content, 'updates must not ping');
        $this->assertStringStartsWith('Update: ', $update->embed['title']);

        // Gone from the index → resolved, quiet all-clear.
        $this->stub([
            self::BASE.'/index.json' => $this->index([]),
            self::BASE.'/issues/2026-08-26_live-deployment/index.json' => array_replace($edited, ['body' => $this->body(), 'resolved' => true, 'resolvedAt' => '2026-08-26 18:02:00 +0000 UTC']),
        ]);
        $this->assertSame([['resolved', '2026-08-26_live-deployment']], RsiStatus::poll());
        $incident = RsiIncident::sole();
        $this->assertTrue($incident->resolved);
        $this->assertSame('2026-08-26 18:02:00', $incident->resolved_at->toDateTimeString());
        $this->assertCount(3, Queue::pushed(NotifyDiscord::class));
        $this->assertStringStartsWith('Resolved: ', Queue::pushed(NotifyDiscord::class)->last()->embed['title']);

        $current = RsiStatus::current();
        $this->assertSame([], $current['active']);
        $this->assertCount(1, $current['recent']);
        $this->assertSame('ok', $current['summary']);
    }

    public function test_no_channel_means_no_discord_but_still_mirrored(): void
    {
        config(['starbuddy.status_channel_id' => null]);
        Queue::fake();
        $this->stub([
            self::BASE.'/index.json' => $this->index([$this->issue()]),
            self::BASE.'/issues/*' => $this->issue(['body' => $this->body()]),
        ]);

        RsiStatus::poll();

        Queue::assertNothingPushed();
        $active = RsiStatus::current()['active'];
        $this->assertCount(1, $active);
        $this->assertSame('2026-08-26T14:45:00+00:00', $active[0]['shutdown_at']);
        $this->assertStringContainsString('**Players are strongly advised', $active[0]['body_text']);
        $this->assertStringNotContainsString('<p>', $active[0]['body_text']);
    }

    public function test_time_parsing_and_shutdown_extraction(): void
    {
        $this->assertNull(RsiStatus::parseTime('<no value>'));
        $this->assertNull(RsiStatus::parseTime(null));
        $this->assertSame('2026-08-26 14:15:09', RsiStatus::parseTime('2026-08-26 10:15:09 -0400 -0400')->toDateTimeString());
        $this->assertSame('2026-08-26 14:15:00', RsiStatus::parseTime('2026-08-26 14:15:00 +0000 UTC')->toDateTimeString());

        $start = \Carbon\Carbon::parse('2026-08-26 23:50:00 UTC');
        // Shutdown after midnight rolls to the next day.
        $this->assertSame('2026-08-27 00:20:00', RsiStatus::shutdownTime('<p>Servers will go offline at 0020 UTC.</p>', $start)->toDateTimeString());
        $this->assertSame('2026-08-26 14:45:00', RsiStatus::shutdownTime('<p>Servers will be taken offline at 14:45 UTC</p>', \Carbon\Carbon::parse('2026-08-26 14:15:00 UTC'))->toDateTimeString());
        $this->assertNull(RsiStatus::shutdownTime('<p>Matchmaking disabled.</p>', $start));
    }

    public function test_status_endpoints_share_the_payload(): void
    {
        config(['starbuddy.bot_api_token' => 'secret']);
        RsiIncident::create([
            'slug' => 'x', 'title' => 'Login issues', 'severity' => 'disrupted', 'affected' => ['Platform'],
            'body_html' => '<p>Investigating.</p>', 'started_at' => now(), 'rsi_updated_at' => now(), 'body_hash' => 'h',
        ]);

        $this->getJson('/api/status')->assertUnauthorized();
        $this->withToken('secret')->getJson('/api/bot/status')
            ->assertOk()
            ->assertJsonPath('active.0.title', 'Login issues')
            ->assertJsonPath('active.0.body_text', 'Investigating.');

        $user = \App\Models\User::factory()->create(['discord_id' => '4242']);
        $this->actingAs($user)->getJson('/api/status')->assertOk()->assertJsonPath('active.0.severity', 'disrupted');
    }
}
