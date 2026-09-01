<?php

namespace Tests\Feature;

use App\Models\Org;
use App\Models\ScreenshotSubmission;
use App\Models\User;
use App\Support\TrainingLabels;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ScreenshotSubmissionTest extends TestCase
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
        $other = Org::create(['name' => 'Other Org']);
        $this->manager = User::factory()->create(['discord_id' => '1']);
        $this->member = User::factory()->create(['discord_id' => '2', 'handle' => 'DK-Raven']);
        $this->outsider = User::factory()->create(['discord_id' => '3']);
        $org->memberships()->attach($this->manager->id, ['role' => 'manager', 'status' => 'active']);
        $org->memberships()->attach($this->member->id, ['role' => 'member', 'status' => 'active']);
        $other->memberships()->attach($this->outsider->id, ['role' => 'member', 'status' => 'active']);
    }

    /** A capture-sized png the validator and getimagesize() both accept. */
    private function capture(string $seed = 'a'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent(
            $seed.'-capture.png',
            $this->pngOfSize(2560, 1440, $seed),
        );
    }

    /**
     * A real, valid PNG of the given size, built by hand.
     *
     * UploadedFile::fake()->image() needs the GD extension, which the app image
     * does not ship. The upload path reads dimensions with getimagesize() and
     * the mime type from the bytes, so both have to be genuine.
     */
    private function pngOfSize(int $width, int $height, string $seed = 'a'): string
    {
        $chunk = function (string $type, string $data): string {
            return pack('N', strlen($data)).$type.$data.pack('N', crc32($type.$data));
        };

        // 8-bit greyscale: one byte per pixel, one filter byte per scanline.
        $header = pack('NN', $width, $height).pack('C5', 8, 0, 0, 0, 0);
        $shade = chr(ord($seed[0]) % 256);
        $scanlines = str_repeat("\0".str_repeat($shade, $width), $height);

        return "\x89PNG\r\n\x1a\n"
            .$chunk('IHDR', $header)
            .$chunk('IDAT', gzcompress($scanlines, 9))
            .$chunk('IEND', '');
    }

    /** @return array<string, mixed> */
    private function payload(array $overrides = []): array
    {
        return array_merge([
            'screen' => 'freight_manager',
            'hud_colour' => 'amber',
            'patch' => '4.10.0',
            'ship' => 'argo_mole',
            'occluded' => true,
            'quad' => [[0.15, 0.2], [0.79, 0.11], [0.81, 0.8], [0.16, 0.83]],
        ], $overrides);
    }

    public function test_member_submits_a_capture_and_sees_it_in_their_own_list(): void
    {
        $this->actingAs($this->member)
            ->postJson('/api/training/screenshots', $this->payload(['image' => $this->capture()]))
            ->assertCreated()
            ->assertJsonPath('status', 'pending')
            ->assertJsonPath('screen', 'freight_manager')
            ->assertJsonPath('width', 2560);

        $this->actingAs($this->member)
            ->getJson('/api/training/screenshots')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('can_review', false)
            ->assertJsonPath('counts.pending', 1);

        $stored = ScreenshotSubmission::sole();
        Storage::disk('local')->assertExists($stored->image_path);
    }

    public function test_corners_are_reordered_to_top_left_first_whatever_the_click_order(): void
    {
        // Clicked bottom-right, bottom-left, top-left, top-right.
        $this->actingAs($this->member)
            ->postJson('/api/training/screenshots', $this->payload([
                'image' => $this->capture(),
                'quad' => [[0.81, 0.8], [0.16, 0.83], [0.15, 0.2], [0.79, 0.11]],
            ]))
            ->assertCreated();

        $quad = ScreenshotSubmission::sole()->quad;
        $this->assertSame([0.15, 0.2], $quad[0], 'top-left first');
        $this->assertSame([0.79, 0.11], $quad[1], 'then top-right');
        $this->assertSame([0.81, 0.8], $quad[2], 'then bottom-right');
        $this->assertSame([0.16, 0.83], $quad[3], 'then bottom-left');
    }

    public function test_four_clicks_in_the_same_spot_are_rejected(): void
    {
        $this->actingAs($this->member)
            ->postJson('/api/training/screenshots', $this->payload([
                'image' => $this->capture(),
                'quad' => [[0.5, 0.5], [0.52, 0.5], [0.52, 0.52], [0.5, 0.52]],
            ]))
            ->assertStatus(422);

        $this->assertSame(0, ScreenshotSubmission::count());
    }

    public function test_the_same_screenshot_cannot_be_submitted_twice(): void
    {
        $first = UploadedFile::fake()->createWithContent('shot.png', $this->pngBytes());
        $again = UploadedFile::fake()->createWithContent('shot-renamed.png', $this->pngBytes());

        $this->actingAs($this->member)
            ->postJson('/api/training/screenshots', $this->payload(['image' => $first]))
            ->assertCreated();

        $this->actingAs($this->outsider)
            ->postJson('/api/training/screenshots', $this->payload(['image' => $again]))
            ->assertStatus(422);

        $this->assertSame(1, ScreenshotSubmission::count());
    }

    public function test_members_cannot_reach_the_review_queue_or_the_export(): void
    {
        $this->actingAs($this->member)->getJson('/api/training/screenshots/queue')->assertForbidden();
        $this->actingAs($this->member)->get('/api/training/screenshots/export')->assertForbidden();
    }

    public function test_manager_reviews_the_queue_and_can_fix_the_corners_first(): void
    {
        $this->actingAs($this->member)
            ->postJson('/api/training/screenshots', $this->payload(['image' => $this->capture()]))
            ->assertCreated();
        $id = ScreenshotSubmission::sole()->id;

        $this->actingAs($this->manager)
            ->getJson('/api/training/screenshots/queue')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.submitted_by', 'DK-Raven');

        $this->actingAs($this->manager)
            ->patchJson("/api/training/screenshots/{$id}", [
                'screen' => 'inventory',
                'quad' => [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]],
            ])
            ->assertOk()
            ->assertJsonPath('screen', 'inventory');

        $this->actingAs($this->manager)
            ->postJson("/api/training/screenshots/{$id}/review", ['status' => 'approved'])
            ->assertOk()
            ->assertJsonPath('status', 'approved');

        $submission = ScreenshotSubmission::sole();
        $this->assertSame($this->manager->id, $submission->reviewed_by);
        $this->assertNotNull($submission->reviewed_at);
    }

    public function test_export_contains_the_images_and_a_labels_file_the_trainer_can_read(): void
    {
        $this->actingAs($this->member)
            ->postJson('/api/training/screenshots', $this->payload(['image' => $this->capture('a')]))
            ->assertCreated();
        $this->actingAs($this->member)
            ->postJson('/api/training/screenshots', $this->payload(['image' => $this->capture('b')]))
            ->assertCreated();

        $approved = ScreenshotSubmission::orderBy('id')->first();
        $this->actingAs($this->manager)
            ->postJson("/api/training/screenshots/{$approved->id}/review", ['status' => 'approved'])
            ->assertOk();

        $response = $this->actingAs($this->manager)->get('/api/training/screenshots/export');
        $response->assertOk();

        $zipPath = tempnam(sys_get_temp_dir(), 'export-test-');
        file_put_contents($zipPath, $response->streamedContent());

        $zip = new \ZipArchive();
        $this->assertTrue($zip->open($zipPath) === true);
        $labels = $zip->getFromName('labels.jsonl');
        $this->assertNotFalse($labels, 'labels.jsonl is present');

        $rows = array_filter(explode("\n", trim($labels)));
        $this->assertCount(1, $rows, 'only the approved capture is exported');

        $row = json_decode($rows[0], true);
        $this->assertSame('4.10.0-argo_mole-freight_manager-1.png', $row['image']);
        $this->assertCount(4, $row['quad']);
        $this->assertSame($this->member->id.'-freight_manager-4.10.0', $row['session']);
        $this->assertNotFalse($zip->locateName('images/'.$row['image']), 'the image is in the archive');
        $zip->close();

        $this->assertNotNull(ScreenshotSubmission::find($approved->id)->exported_at);
        @unlink($zipPath);
    }

    public function test_a_stranger_cannot_fetch_someone_elses_screenshot(): void
    {
        $this->actingAs($this->member)
            ->postJson('/api/training/screenshots', $this->payload(['image' => $this->capture()]))
            ->assertCreated();
        $id = ScreenshotSubmission::sole()->id;

        $this->actingAs($this->outsider)->get("/api/training/screenshots/{$id}/image")->assertForbidden();
        $this->actingAs($this->member)->get("/api/training/screenshots/{$id}/image")->assertOk();
        $this->actingAs($this->manager)->get("/api/training/screenshots/{$id}/image")->assertOk();
    }

    public function test_quad_ordering_helper_handles_every_click_order(): void
    {
        $truth = [[0.1, 0.2], [0.9, 0.15], [0.95, 0.8], [0.15, 0.85]];

        for ($rotation = 0; $rotation < 4; $rotation++) {
            $rotated = $truth;
            for ($i = 0; $i < $rotation; $i++) {
                array_push($rotated, array_shift($rotated));
            }
            $this->assertSame($truth, TrainingLabels::orderQuad($rotated), "rotation {$rotation}");
            $this->assertSame($truth, TrainingLabels::orderQuad(array_reverse($rotated)), "reversed {$rotation}");
        }
    }


    public function test_a_contributor_can_name_a_screen_nobody_has_submitted_before(): void
    {
        $this->actingAs($this->member)
            ->postJson('/api/training/screenshots', $this->payload([
                'image' => $this->capture(),
                'screen' => 'Cargo Deck Terminal',
                'ship' => 'RSI Zeus MK II',
            ]))
            ->assertCreated()
            ->assertJsonPath('screen', 'cargo_deck_terminal')
            ->assertJsonPath('ship', 'rsi_zeus_mk_ii');

        // The new name joins the vocabulary the next contributor autocompletes against.
        $this->actingAs($this->member)
            ->getJson('/api/training/labels')
            ->assertOk()
            ->assertJsonFragment(['name' => 'cargo_deck_terminal', 'count' => 1])
            ->assertJsonFragment(['name' => 'rsi_zeus_mk_ii', 'count' => 1]);
    }

    public function test_differently_typed_names_fold_into_one_class(): void
    {
        foreach (['Freight Manager', 'freight manager', 'freight-manager!'] as $index => $typed) {
            $this->actingAs($this->member)
                ->postJson('/api/training/screenshots', $this->payload([
                    'image' => $this->capture((string) $index),
                    'screen' => $typed,
                ]))
                ->assertCreated();
        }

        $this->assertSame(
            ['freight_manager'],
            ScreenshotSubmission::distinct()->pluck('screen')->all(),
            'three spellings, one class',
        );
    }

    public function test_a_screen_name_with_no_letters_or_numbers_is_refused(): void
    {
        $this->actingAs($this->member)
            ->postJson('/api/training/screenshots', $this->payload([
                'image' => $this->capture(),
                'screen' => '---',
            ]))
            ->assertStatus(422);
    }

    public function test_the_sampled_hud_colour_is_kept_and_exported(): void
    {
        $this->actingAs($this->member)
            ->postJson('/api/training/screenshots', $this->payload([
                'image' => $this->capture(),
                'hud_hex' => '#E8A33D',
            ]))
            ->assertCreated()
            ->assertJsonPath('hud_hex', '#e8a33d');

        $id = ScreenshotSubmission::sole()->id;
        $this->actingAs($this->manager)
            ->postJson("/api/training/screenshots/{$id}/review", ['status' => 'approved'])
            ->assertOk();

        $row = $this->firstExportedLabel();
        $this->assertSame('#e8a33d', $row['hud_hex']);
    }

    public function test_an_invalid_hex_is_refused(): void
    {
        $this->actingAs($this->member)
            ->postJson('/api/training/screenshots', $this->payload([
                'image' => $this->capture(),
                'hud_hex' => 'amberish',
            ]))
            ->assertStatus(422);
    }

    public function test_the_export_carries_its_own_screen_encoding(): void
    {
        $this->actingAs($this->member)
            ->postJson('/api/training/screenshots', $this->payload([
                'image' => $this->capture(),
                'screen' => 'Cargo Deck Terminal',
            ]))
            ->assertCreated();

        $id = ScreenshotSubmission::sole()->id;
        $this->actingAs($this->manager)
            ->postJson("/api/training/screenshots/{$id}/review", ['status' => 'approved'])
            ->assertOk();

        $zip = $this->openExport();
        $screens = $zip->getFromName('screens.yaml');
        $zip->close();

        $this->assertNotFalse($screens, 'screens.yaml is present');
        // Seeded screens keep their positions; the new name is appended, so an
        // encoding trained earlier stays valid.
        $this->assertStringContainsString("screens:\n  - freight_manager\n", $screens);
        $this->assertStringContainsString('  - cargo_deck_terminal', $screens);
        $this->assertLessThan(
            strpos($screens, 'cargo_deck_terminal'),
            strpos($screens, 'other'),
            'contributed names come after the seeded ones',
        );
    }

    private function openExport(): \ZipArchive
    {
        $response = $this->actingAs($this->manager)->get('/api/training/screenshots/export');
        $response->assertOk();
        $path = tempnam(sys_get_temp_dir(), 'export-test-');
        file_put_contents($path, $response->streamedContent());

        $zip = new \ZipArchive();
        $this->assertTrue($zip->open($path) === true);

        return $zip;
    }

    /** @return array<string, mixed> */
    private function firstExportedLabel(): array
    {
        $zip = $this->openExport();
        $labels = $zip->getFromName('labels.jsonl');
        $zip->close();
        $this->assertNotFalse($labels);

        return json_decode(trim(explode("\n", trim($labels))[0]), true);
    }

public function test_the_queue_reports_approved_coverage_per_screen(): void
    {
        $submit = function (string $seed, string $screen) {
            $this->actingAs($this->member)
                ->postJson('/api/training/screenshots', $this->payload([
                    'image' => $this->capture($seed),
                    'screen' => $screen,
                ]))
                ->assertCreated();

            return ScreenshotSubmission::latest('id')->first()->id;
        };

        $approved = $submit('a', 'refinery_order');
        $submit('b', 'refinery_order');           // stays pending
        $submit('c', 'Kiosk Prices');            // pending, and a new-ish name

        $this->actingAs($this->manager)
            ->postJson("/api/training/screenshots/{$approved}/review", ['status' => 'approved'])
            ->assertOk();

        $coverage = $this->actingAs($this->manager)
            ->getJson('/api/training/screenshots/queue')
            ->assertOk()
            ->json('coverage');

        $this->assertSame(TrainingLabels::MIN_PER_SCREEN, $coverage['target']);

        $byScreen = collect($coverage['screens'])->keyBy('screen');
        $this->assertSame(1, $byScreen['refinery_order']['approved']);
        $this->assertSame(1, $byScreen['refinery_order']['pending']);
        $this->assertSame(0, $byScreen['kiosk_prices']['approved']);
        $this->assertSame(1, $byScreen['kiosk_prices']['pending']);
        // Screens nobody has touched are still listed — an empty screen is the
        // thing a manager most needs to see.
        $this->assertSame(0, $byScreen['scan_result']['approved']);

        // Emptiest first: the panel is a work queue.
        $this->assertSame(
            0,
            $coverage['screens'][0]['approved'],
            'the emptiest screen leads the list',
        );
    }

    public function test_seeded_screen_positions_never_shift(): void
    {
        // Position in this list is the label the model is trained against, so
        // the screens that existed first must keep their indexes forever.
        $this->assertSame(
            [
                'freight_manager',
                'fabrication_kiosk_blueprints',
                'fabrication_kiosk_materials',
                'scanning_signature',
                'scan_result',
                'refinery_order',
                'inventory',
                'other',
            ],
            array_slice(TrainingLabels::SEEDED_SCREENS, 0, 8),
        );
    }

    /** A minimal valid 1x1 png, so two uploads can share identical bytes. */
    private function pngBytes(): string
    {
        return base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
        );
    }
}
