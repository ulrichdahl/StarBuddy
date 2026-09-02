<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Org;
use App\Models\ScreenshotSubmission;
use App\Models\User;
use App\Support\TrainingLabels;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;
use ZipArchive;

/**
 * Contributed training screenshots for the panel detector.
 *
 * Flow: a member uploads one capture with the panel's four corners marked
 * (POST /training/screenshots), a manager works through the queue
 * (GET .../queue, POST .../{id}/review), and approved rows leave as one zip
 * (GET .../export) holding the images plus a labels.jsonl the `ml/` training
 * scripts read directly.
 *
 * Images live on the private disk. They are only ever served back through
 * `image()`, which checks that the caller submitted the capture or manages the
 * org reviewing it.
 */
class ScreenshotSubmissionController extends Controller
{
    private const DISK = 'local';
    private const DIRECTORY = 'training/screenshots';

    /** Smallest believable panel, as a fraction of the frame. */
    private const MIN_QUAD_AREA = 0.01;

    /**
     * The vocabularies the submit form autocompletes against.
     *
     * Screens and ships are open sets — a contributor can name a panel or a
     * ship nobody has submitted yet — so they come back with usage counts,
     * most-used first, which puts the names other people already chose at the
     * top of the list and keeps the vocabulary from fragmenting.
     */
    public function labels()
    {
        return [
            'screens' => $this->vocabulary('screen', TrainingLabels::SEEDED_SCREENS),
            'ships' => $this->vocabulary('ship'),
            'hud_colours' => TrainingLabels::HUD_COLOURS,
            'corners' => TrainingLabels::CORNERS,
            'patch' => config('starbuddy.game_patch'),
            'max_bytes' => 20 * 1024 * 1024,
        ];
    }

    /**
     * Distinct values of one column with counts, seeded names included even
     * when nothing has been submitted for them yet.
     *
     * @param  array<int, string>  $seeded
     * @return array<int, array{name: string, count: int}>
     */
    private function vocabulary(string $column, array $seeded = []): array
    {
        $counts = ScreenshotSubmission::query()
            ->whereIn('status', TrainingLabels::REVIEW_STATUSES)
            ->whereNotNull($column)
            ->where($column, '!=', '')
            ->selectRaw("{$column} as name, count(*) as total")
            ->groupBy($column)
            ->pluck('total', 'name')
            ->all();

        foreach ($seeded as $name) {
            $counts[$name] ??= 0;
        }

        $vocabulary = [];
        foreach ($counts as $name => $total) {
            $vocabulary[] = ['name' => (string) $name, 'count' => (int) $total];
        }

        usort($vocabulary, fn ($a, $b) => [$b['count'], $a['name']] <=> [$a['count'], $b['name']]);

        return $vocabulary;
    }

    /** The caller's own submissions, newest first. */
    public function index(Request $request)
    {
        $submissions = ScreenshotSubmission::where('user_id', $request->user()->id)
            ->whereIn('status', TrainingLabels::REVIEW_STATUSES)
            ->latest()
            ->paginate(24);

        return [
            'data' => $submissions->getCollection()->map(fn ($s) => $this->present($s))->all(),
            'meta' => [
                'total' => $submissions->total(),
                'per_page' => $submissions->perPage(),
                'current_page' => $submissions->currentPage(),
                'last_page' => $submissions->lastPage(),
            ],
            'can_review' => $this->managedOrgIds($request->user()) !== [],
            'counts' => $this->counts($request->user()),
        ];
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'image' => ['required', 'file', 'mimetypes:image/png,image/jpeg', 'max:20480'],
            'screen' => ['required', 'string', 'max:60'],
            'hud_colour' => ['required', Rule::in(TrainingLabels::HUD_COLOURS)],
            'hud_hex' => ['nullable', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'patch' => ['required', 'string', 'max:20'],
            'ship' => ['nullable', 'string', 'max:60'],
            'occluded' => ['required', 'boolean'],
            'submitter_note' => ['nullable', 'string', 'max:500'],
            'quad' => ['required', 'array', 'size:4'],
            'quad.*' => ['required', 'array', 'size:2'],
            'quad.*.*' => ['required', 'numeric', 'between:-0.5,1.5'],
        ]);

        // Typed names are folded to the corpus convention so "Freight Manager"
        // and "freight_manager" are one class rather than two.
        $screen = TrainingLabels::normaliseName($data['screen']);
        abort_if($screen === '', 422, 'Give the screen a name using letters or numbers.');
        $ship = TrainingLabels::normaliseName($data['ship'] ?? '');

        $file = $request->file('image');
        $hash = hash_file('sha256', $file->getRealPath());

        $existing = ScreenshotSubmission::where('image_hash', $hash)->first();
        if ($existing) {
            return response()->json([
                'message' => $existing->user_id === $request->user()->id
                    ? 'You have already submitted this screenshot.'
                    : 'This screenshot has already been submitted by someone else.',
            ], 422);
        }

        $size = @getimagesize($file->getRealPath());
        abort_unless($size !== false, 422, 'That file is not a readable image.');

        // Corners may be clicked in any order, and a corner that falls outside
        // the frame is kept as clicked — the panel really does run off the edge
        // in some captures, and clamping would teach the model to stop there.
        $quad = TrainingLabels::orderQuad(array_map(
            fn ($point) => [(float) $point[0], (float) $point[1]],
            $data['quad'],
        ));

        abort_if(
            TrainingLabels::area($quad) < self::MIN_QUAD_AREA,
            422,
            'Those four corners barely enclose anything. Mark the corners of the lit screen.',
        );

        $path = $file->storeAs(
            self::DIRECTORY,
            $hash.'.'.($file->getMimeType() === 'image/jpeg' ? 'jpg' : 'png'),
            self::DISK,
        );

        $submission = ScreenshotSubmission::create([
            'user_id' => $request->user()->id,
            'org_id' => $request->user()->orgs()->value('orgs.id'),
            'status' => 'pending',
            'image_path' => $path,
            'image_hash' => $hash,
            'mime' => $file->getMimeType(),
            'width' => $size[0],
            'height' => $size[1],
            'bytes' => $file->getSize(),
            'patch' => $data['patch'],
            'ship' => $ship ?: null,
            'screen' => $screen,
            'hud_colour' => $data['hud_colour'],
            'hud_hex' => isset($data['hud_hex']) ? strtolower($data['hud_hex']) : null,
            'occluded' => $data['occluded'],
            'quad' => $quad,
            'submitter_note' => $data['submitter_note'] ?? null,
        ]);

        return response()->json($this->present($submission), 201);
    }

    /** The review queue, for managers. */
    public function queue(Request $request)
    {
        $orgIds = $this->authorizeReviewer($request->user());

        $status = $request->query('status', 'pending');
        abort_unless(in_array($status, TrainingLabels::REVIEW_STATUSES, true), 422, 'Unknown status.');

        $submissions = ScreenshotSubmission::reviewableBy($orgIds)
            ->where('status', $status)
            ->with('user:id,name,handle')
            ->orderBy('created_at')
            ->paginate(24);

        return [
            'data' => $submissions->getCollection()->map(fn ($s) => $this->present($s, true))->all(),
            'meta' => [
                'total' => $submissions->total(),
                'per_page' => $submissions->perPage(),
                'current_page' => $submissions->currentPage(),
                'last_page' => $submissions->lastPage(),
            ],
            'counts' => $this->queueCounts($orgIds),
            'coverage' => $this->coverage($orgIds),
        ];
    }

    /**
     * Approved captures per screen, so a manager can see which areas are short
     * rather than only how many screenshots exist in total.
     *
     * Every screen anyone has submitted is listed, plus the seeded ones at zero,
     * because a screen with nothing collected is exactly what needs saying.
     *
     * @param  array<int, int>  $orgIds
     * @return array{target: int, screens: array<int, array{screen: string, approved: int, pending: int}>}
     */
    private function coverage(array $orgIds): array
    {
        $rows = ScreenshotSubmission::reviewableBy($orgIds)
            ->whereIn('status', TrainingLabels::REVIEW_STATUSES)
            ->whereNotNull('screen')
            ->selectRaw('screen, status, count(*) as total')
            ->groupBy('screen', 'status')
            ->get();

        $screens = [];
        foreach (TrainingLabels::SEEDED_SCREENS as $screen) {
            $screens[$screen] = ['screen' => $screen, 'approved' => 0, 'pending' => 0];
        }
        foreach ($rows as $row) {
            $screens[$row->screen] ??= ['screen' => $row->screen, 'approved' => 0, 'pending' => 0];
            if ($row->status === 'approved') {
                $screens[$row->screen]['approved'] = (int) $row->total;
            } elseif ($row->status === 'pending') {
                $screens[$row->screen]['pending'] = (int) $row->total;
            }
        }

        $coverage = array_values($screens);
        // Emptiest first: the list is a work queue, not a leaderboard.
        usort($coverage, fn ($a, $b) => [$a['approved'], $a['screen']] <=> [$b['approved'], $b['screen']]);

        return ['target' => TrainingLabels::MIN_PER_SCREEN, 'screens' => $coverage];
    }

    /** Stream the capture itself to its submitter or a reviewing manager. */
    public function image(Request $request, ScreenshotSubmission $submission)
    {
        $this->authorizeView($request->user(), $submission);
        abort_unless(Storage::disk(self::DISK)->exists($submission->image_path), 404);

        return Storage::disk(self::DISK)->response(
            $submission->image_path,
            null,
            ['Content-Type' => $submission->mime, 'Cache-Control' => 'private, max-age=3600'],
        );
    }

    /**
     * A manager corrects the labels or the corners before approving.
     *
     * Fixing beats rejecting: the capture is already collected, and slightly
     * misplaced corners are a thirty-second repair rather than a lost example.
     */
    public function update(Request $request, ScreenshotSubmission $submission)
    {
        $this->authorizeReviewerFor($request->user(), $submission);

        $data = $request->validate([
            'screen' => ['sometimes', 'string', 'max:60'],
            'hud_colour' => ['sometimes', Rule::in(TrainingLabels::HUD_COLOURS)],
            'hud_hex' => ['sometimes', 'nullable', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'patch' => ['sometimes', 'string', 'max:20'],
            'ship' => ['sometimes', 'nullable', 'string', 'max:60'],
            'occluded' => ['sometimes', 'boolean'],
            'quad' => ['sometimes', 'array', 'size:4'],
            'quad.*' => ['required_with:quad', 'array', 'size:2'],
            'quad.*.*' => ['required_with:quad', 'numeric', 'between:-0.5,1.5'],
        ]);

        // A manager retyping the screen name is how two names for one panel get
        // merged, so the same normalisation applies here.
        if (isset($data['screen'])) {
            $data['screen'] = TrainingLabels::normaliseName($data['screen']);
            abort_if($data['screen'] === '', 422, 'Give the screen a name using letters or numbers.');
        }
        if (array_key_exists('ship', $data)) {
            $data['ship'] = TrainingLabels::normaliseName((string) $data['ship']) ?: null;
        }

        if (isset($data['quad'])) {
            $data['quad'] = TrainingLabels::orderQuad(array_map(
                fn ($point) => [(float) $point[0], (float) $point[1]],
                $data['quad'],
            ));
            abort_if(
                TrainingLabels::area($data['quad']) < self::MIN_QUAD_AREA,
                422,
                'Those four corners barely enclose anything.',
            );
        }

        $submission->update($data);

        return $this->present($submission->fresh(), true);
    }

    public function review(Request $request, ScreenshotSubmission $submission)
    {
        $this->authorizeReviewerFor($request->user(), $submission);

        $data = $request->validate([
            'status' => ['required', Rule::in(['approved', 'rejected'])],
            'review_note' => ['nullable', 'string', 'max:500'],
        ]);

        $submission->update([
            'status' => $data['status'],
            'review_note' => $data['review_note'] ?? null,
            'reviewed_by' => $request->user()->id,
            'reviewed_at' => now(),
        ]);

        AuditLog::create([
            'user_id' => $request->user()->id,
            'org_id' => $submission->org_id,
            'action' => 'training.screenshot_'.$data['status'],
            'details' => ['submission' => $submission->id, 'screen' => $submission->screen],
        ]);

        return $this->present($submission->fresh(), true);
    }

    /**
     * Download the approved set as one zip: the images plus a labels.jsonl in
     * the exact shape `ml/src/starbuddy_ml/schema.py` loads.
     */
    public function export(Request $request): StreamedResponse
    {
        $orgIds = $this->authorizeReviewer($request->user());

        $submissions = ScreenshotSubmission::reviewableBy($orgIds)
            ->where('status', 'approved')
            ->orderBy('id')
            ->get();

        abort_if($submissions->isEmpty(), 404, 'Nothing has been approved yet.');

        $archive = tempnam(sys_get_temp_dir(), 'starbuddy-dataset-');
        $zip = new ZipArchive();
        abort_unless($zip->open($archive, ZipArchive::OVERWRITE) === true, 500, 'Could not build the archive.');

        $labels = [];
        $sequence = [];
        foreach ($submissions as $submission) {
            if (! Storage::disk(self::DISK)->exists($submission->image_path)) {
                continue; // the row outlived its file; skip rather than fail the export
            }

            $key = $submission->screen;
            $sequence[$key] = ($sequence[$key] ?? 0) + 1;
            $filename = $submission->exportFilename($sequence[$key]);

            $zip->addFile(
                Storage::disk(self::DISK)->path($submission->image_path),
                'images/'.$filename,
            );

            $labels[] = json_encode([
                'image' => $filename,
                'patch' => $submission->patch,
                'screen' => $submission->screen,
                'ship' => $submission->ship,
                'hud_colour' => $submission->hud_colour,
                'hud_hex' => $submission->hud_hex,
                'occluded' => $submission->occluded,
                'session' => $submission->sessionKey(),
                'quad' => $submission->quad,
            ], JSON_UNESCAPED_SLASHES);
        }

        abort_if($labels === [], 404, 'Every approved submission is missing its image file.');

        $zip->addFromString('labels.jsonl', implode("\n", $labels)."\n");
        // Screens are an open vocabulary, so each export carries the encoding it
        // was built with. A dataset that names its own classes stays trainable
        // even after someone contributes a screen nobody had seen before.
        $vocabulary = TrainingLabels::screenVocabulary(
            $submissions->sortBy('id')->pluck('screen')->unique()->values()->all(),
        );
        $zip->addFromString('screens.yaml', $this->screensYaml($vocabulary));
        $zip->addFromString('README.txt', $this->exportReadme(count($labels)));
        $zip->close();

        ScreenshotSubmission::whereIn('id', $submissions->pluck('id'))->update(['exported_at' => now()]);

        $name = 'starbuddy-scan-dataset-'.now()->format('Ymd-His').'.zip';

        return response()->streamDownload(function () use ($archive) {
            readfile($archive);
            @unlink($archive);
        }, $name, ['Content-Type' => 'application/zip']);
    }

    private function exportReadme(int $count): string
    {
        return <<<TXT
        StarBuddy panel-detector dataset
        {$count} approved screenshots, exported {$this->timestamp()}.

        Unpack next to the training code and point it at this folder:

            unzip this.zip -d ml/datasets/scan-v2
            cd ml
            uv run python -m starbuddy_ml.train --config configs/stage_a.yaml \\
                --labels datasets/scan-v2/labels.jsonl \\
                --images datasets/scan-v2/images

        labels.jsonl holds one JSON object per capture: the filename, the four
        panel corners normalised 0..1 in top-left, top-right, bottom-right,
        bottom-left order, the screen, the ship, the HUD colour (named bucket
        plus the hex a contributor sampled off the panel), whether the panel was
        partly blocked, and a session key. The session key groups captures that
        are near-duplicates so the train/validation split can keep them
        together — do not shuffle rows across it.

        screens.yaml is this dataset's label encoding. Contributors can name a
        screen nobody has submitted before, so paste that block over the
        'screens:' list in configs/stage_a.yaml before training, or the run will
        stop on the first capture whose screen is not in the config.
        TXT;
    }

    /**
     * The `screens:` block for configs/stage_a.yaml, in encoding order.
     *
     * @param  array<int, string>  $vocabulary
     */
    private function screensYaml(array $vocabulary): string
    {
        $lines = ["# Paste over the 'screens:' list in ml/configs/stage_a.yaml before training", 'screens:'];
        foreach ($vocabulary as $screen) {
            $lines[] = '  - '.$screen;
        }

        return implode("\n", $lines)."\n";
    }

    private function timestamp(): string
    {
        return now()->toDateString();
    }

    /** @return array<string, int> */
    private function counts(User $user): array
    {
        return ScreenshotSubmission::where('user_id', $user->id)
            ->selectRaw('status, count(*) as total')
            ->groupBy('status')
            ->pluck('total', 'status')
            ->all();
    }

    /**
     * @param  array<int, int>  $orgIds
     * @return array<string, int>
     */
    private function queueCounts(array $orgIds): array
    {
        return ScreenshotSubmission::reviewableBy($orgIds)
            ->whereIn('status', TrainingLabels::REVIEW_STATUSES)
            ->selectRaw('status, count(*) as total')
            ->groupBy('status')
            ->pluck('total', 'status')
            ->all();
    }

    /** @return array<int, int> */
    private function managedOrgIds(User $user): array
    {
        return $user->orgs()
            ->wherePivotIn('role', ['manager', 'admin'])
            ->pluck('orgs.id')
            ->all();
    }

    /** @return array<int, int> */
    private function authorizeReviewer(User $user): array
    {
        $orgIds = $this->managedOrgIds($user);
        abort_if($orgIds === [], 403, 'Only org managers review contributed screenshots.');

        return $orgIds;
    }

    private function authorizeReviewerFor(User $user, ScreenshotSubmission $submission): void
    {
        $orgIds = $this->authorizeReviewer($user);
        abort_unless(
            $submission->org_id === null || in_array($submission->org_id, $orgIds, true),
            403,
            'That submission belongs to another org.',
        );
    }

    private function authorizeView(User $user, ScreenshotSubmission $submission): void
    {
        if ($submission->user_id === $user->id) {
            return;
        }

        $orgIds = $this->managedOrgIds($user);
        abort_unless(
            $orgIds !== [] && ($submission->org_id === null || in_array($submission->org_id, $orgIds, true)),
            403,
            'You cannot view that screenshot.',
        );
    }

    /** @return array<string, mixed> */
    private function present(ScreenshotSubmission $submission, bool $forReview = false): array
    {
        $payload = [
            'id' => $submission->id,
            'status' => $submission->status,
            'origin' => $submission->origin,
            'screen' => $submission->screen,
            'hud_colour' => $submission->hud_colour,
            'hud_hex' => $submission->hud_hex,
            'patch' => $submission->patch,
            'ship' => $submission->ship,
            'occluded' => $submission->occluded,
            'quad' => $submission->quad,
            'width' => $submission->width,
            'height' => $submission->height,
            'image_url' => "/api/training/screenshots/{$submission->id}/image",
            'submitter_note' => $submission->submitter_note,
            'review_note' => $submission->review_note,
            'created_at' => $submission->created_at?->toIso8601String(),
            'reviewed_at' => $submission->reviewed_at?->toIso8601String(),
            'exported_at' => $submission->exported_at?->toIso8601String(),
        ];

        if ($forReview) {
            $payload['submitted_by'] = $submission->user?->handle ?? $submission->user?->name;
        }

        return $payload;
    }
}
