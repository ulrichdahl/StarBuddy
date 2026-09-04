<?php

namespace Tests\Feature;

use App\Models\Org;
use App\Models\ScreenshotSubmission;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The desktop client's hotkey grab: an image arrives before anyone has said
 * what it shows, waits in the player's own queue, and becomes an ordinary
 * pending submission once labelled.
 */
class ScreenshotCaptureTest extends TestCase
{
    use RefreshDatabase;

    private User $manager;
    private User $member;
    private User $outsider;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');

        $org = Org::create(['name' => 'Stellar Forge']);
        $this->manager = User::factory()->create(['discord_id' => '1']);
        $this->member = User::factory()->create(['discord_id' => '2', 'handle' => 'DK-Raven']);
        $this->outsider = User::factory()->create(['discord_id' => '3']);
        $org->memberships()->attach($this->manager->id, ['role' => 'manager', 'status' => 'active']);
        $org->memberships()->attach($this->member->id, ['role' => 'member', 'status' => 'active']);
        $org->memberships()->attach($this->outsider->id, ['role' => 'member', 'status' => 'active']);
    }

    private function capture(string $seed = 'a'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent(
            $seed.'-capture.png',
            $this->pngOfSize(2560, 1440, $seed),
        );
    }

    /** A real PNG; the app image has no GD, so fake()->image() is unavailable. */
    private function pngOfSize(int $width, int $height, string $seed = 'a'): string
    {
        $chunk = fn (string $type, string $data): string => pack('N', strlen($data)).$type.$data.pack('N', crc32($type.$data));
        $header = pack('NN', $width, $height).pack('C5', 8, 0, 0, 0, 0);
        $scanlines = str_repeat("\0".str_repeat(chr(ord($seed[0]) % 256), $width), $height);

        return "\x89PNG\r\n\x1a\n"
            .$chunk('IHDR', $header)
            .$chunk('IDAT', gzcompress($scanlines, 9))
            .$chunk('IEND', '');
    }

    /** @return array<string, mixed> */
    private function labels(array $overrides = []): array
    {
        return array_merge([
            'screen' => 'Refinery Order',
            'hud_colour' => 'amber',
            'occluded' => false,
            'quad' => [[0.15, 0.2], [0.79, 0.11], [0.81, 0.8], [0.16, 0.83]],
        ], $overrides);
    }

    public function test_the_client_sends_a_capture_and_it_waits_in_the_players_queue(): void
    {
        $this->actingAs($this->member)
            ->postJson('/api/training/captures', ['image' => $this->capture()])
            ->assertCreated()
            ->assertJsonPath('status', 'captured')
            ->assertJsonPath('origin', 'client')
            // The patch is filled in from config, so the client never sends it.
            ->assertJsonPath('patch', config('starbuddy.game_patch'));

        $this->actingAs($this->member)
            ->getJson('/api/training/captures')
            ->assertOk()
            ->assertJsonCount(1, 'data');

        Storage::disk('local')->assertExists(ScreenshotSubmission::sole()->image_path);
    }

    public function test_a_reader_can_say_which_screen_it_was_pointed_at(): void
    {
        // A refinery read already knows what it was looking at, and saying so
        // is what makes a queue searchable when one kind of panel reads badly.
        $this->actingAs($this->member)
            ->postJson('/api/training/captures', [
                'image' => $this->capture(),
                'screen' => 'refinery_order',
                'note' => 'F8 refinery read: 1 order(s), 5 materials, 42 lines, missing cost. Station LEVSKI.',
            ])
            ->assertCreated()
            ->assertJsonPath('screen', 'refinery_order')
            // Still unlabelled: the corners are marked at a desk, not in flight.
            ->assertJsonPath('status', 'captured');

        $capture = ScreenshotSubmission::sole();
        $this->assertSame('refinery_order', $capture->screen);
        $this->assertStringContainsString('LEVSKI', $capture->submitter_note);
    }

    public function test_pressing_the_hotkey_twice_on_one_frame_returns_the_same_capture(): void
    {
        $first = $this->actingAs($this->member)
            ->postJson('/api/training/captures', ['image' => $this->capture()])
            ->assertCreated()
            ->json('id');

        $this->actingAs($this->member)
            ->postJson('/api/training/captures', ['image' => $this->capture()])
            ->assertOk()
            ->assertJsonPath('id', $first);

        $this->assertSame(1, ScreenshotSubmission::count());
    }

    public function test_an_unlabelled_capture_is_invisible_to_reviewers(): void
    {
        $this->actingAs($this->member)
            ->postJson('/api/training/captures', ['image' => $this->capture()])
            ->assertCreated();

        // Not in the queue, not in the counts, not in anyone's submission list.
        $queue = $this->actingAs($this->manager)->getJson('/api/training/screenshots/queue')->assertOk();
        $queue->assertJsonCount(0, 'data');
        $this->assertSame(0, $queue->json('counts.pending') ?? 0);

        $this->actingAs($this->member)
            ->getJson('/api/training/screenshots')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_labelling_a_capture_sends_it_for_review(): void
    {
        $id = $this->actingAs($this->member)
            ->postJson('/api/training/captures', ['image' => $this->capture()])
            ->assertCreated()
            ->json('id');

        $this->actingAs($this->member)
            ->postJson("/api/training/captures/{$id}/contribute", $this->labels(['ship' => 'RSI Zeus MK II']))
            ->assertOk()
            ->assertJsonPath('status', 'pending')
            ->assertJsonPath('screen', 'refinery_order')
            ->assertJsonPath('ship', 'rsi_zeus_mk_ii');

        // It leaves the capture queue and appears to the reviewer.
        $this->actingAs($this->member)->getJson('/api/training/captures')->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($this->manager)
            ->getJson('/api/training/screenshots/queue')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.submitted_by', 'DK-Raven');

        // Corners were sorted top-left first on the way in.
        $this->assertSame([0.15, 0.2], ScreenshotSubmission::sole()->quad[0]);
    }

    public function test_a_capture_cannot_be_labelled_twice(): void
    {
        $id = $this->actingAs($this->member)
            ->postJson('/api/training/captures', ['image' => $this->capture()])
            ->assertCreated()
            ->json('id');

        $this->actingAs($this->member)
            ->postJson("/api/training/captures/{$id}/contribute", $this->labels())
            ->assertOk();

        $this->actingAs($this->member)
            ->postJson("/api/training/captures/{$id}/contribute", $this->labels())
            ->assertStatus(422);
    }

    public function test_captures_are_private_to_the_person_who_took_them(): void
    {
        $id = $this->actingAs($this->member)
            ->postJson('/api/training/captures', ['image' => $this->capture()])
            ->assertCreated()
            ->json('id');

        // Another member's queue is their own, and they cannot act on this one.
        $this->actingAs($this->outsider)->getJson('/api/training/captures')->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($this->outsider)
            ->postJson("/api/training/captures/{$id}/contribute", $this->labels())
            ->assertForbidden();
        $this->actingAs($this->outsider)->deleteJson("/api/training/captures/{$id}")->assertForbidden();
    }

    public function test_discarding_a_capture_removes_its_image(): void
    {
        $id = $this->actingAs($this->member)
            ->postJson('/api/training/captures', ['image' => $this->capture()])
            ->assertCreated()
            ->json('id');
        $path = ScreenshotSubmission::sole()->image_path;

        $this->actingAs($this->member)->deleteJson("/api/training/captures/{$id}")->assertNoContent();

        $this->assertSame(0, ScreenshotSubmission::count());
        Storage::disk('local')->assertMissing($path);
    }

    public function test_an_unlabelled_capture_never_reaches_the_export(): void
    {
        $this->actingAs($this->member)
            ->postJson('/api/training/captures', ['image' => $this->capture()])
            ->assertCreated();

        // Nothing approved, so there is nothing to export — the capture is not
        // silently swept in.
        $this->actingAs($this->manager)->get('/api/training/screenshots/export')->assertNotFound();
    }

    public function test_a_reader_can_send_what_it_made_of_the_frame(): void
    {
        $dump = [
            'station' => 'LEVSKI',
            'missing' => [],
            'lines' => [['text' => 'CORUNDUM ORE 504 131', 'x' => 70, 'y' => 398, 'w' => 318, 'h' => 16]],
        ];

        $this->actingAs($this->member)
            ->postJson('/api/training/captures', [
                'image' => $this->capture('r'),
                'screen' => 'refinery_order',
                'reader' => json_encode($dump),
            ])
            ->assertCreated()
            ->assertJsonPath('reader_dump.station', 'LEVSKI')
            ->assertJsonPath('reader_dump.lines.0.text', 'CORUNDUM ORE 504 131');
    }

    public function test_a_dump_that_is_not_json_does_not_lose_the_capture(): void
    {
        // The frame is the thing worth keeping, and a malformed dump is a
        // client bug rather than a reason to refuse it.
        $this->actingAs($this->member)
            ->postJson('/api/training/captures', [
                'image' => $this->capture('j'),
                'reader' => 'not json at all',
            ])
            ->assertCreated()
            ->assertJsonPath('reader_dump', null);
    }
}
