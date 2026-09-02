<?php

namespace App\Http\Controllers;

use App\Models\ScreenshotSubmission;
use App\Support\TrainingLabels;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

/**
 * Screenshots the desktop client grabbed on a hotkey, before anyone labelled
 * them.
 *
 * Pressing the capture key in game sends the frame straight here, so the player
 * never leaves the cockpit to file it. The image waits in that player's own
 * queue on the training page; marking the corners and naming the screen turns it
 * into an ordinary pending submission for a manager to review.
 *
 * Captures are private to the person who took them. They are not in the review
 * queue, the coverage counts or the export until they have been labelled.
 */
class ScreenshotCaptureController extends Controller
{
    private const DISK = 'local';
    private const DIRECTORY = 'training/screenshots';

    /** Smallest believable panel, as a fraction of the frame. */
    private const MIN_QUAD_AREA = 0.01;

    /**
     * Receive one capture from a paired desktop client.
     *
     * Pressing the hotkey twice on the same frame is a normal accident rather
     * than an error, so an identical image the caller already holds returns that
     * capture instead of a validation failure.
     */
    public function store(Request $request)
    {
        $data = $request->validate([
            'image' => ['required', 'file', 'mimetypes:image/png,image/jpeg', 'max:20480'],
            'patch' => ['nullable', 'string', 'max:20'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);

        $file = $request->file('image');
        $hash = hash_file('sha256', $file->getRealPath());

        $existing = ScreenshotSubmission::where('image_hash', $hash)->first();
        if ($existing) {
            if ($existing->user_id === $request->user()->id && $existing->status === 'captured') {
                return response()->json($this->present($existing), 200);
            }

            return response()->json([
                'message' => $existing->user_id === $request->user()->id
                    ? 'You have already sent this screenshot.'
                    : 'This screenshot has already been sent by someone else.',
            ], 422);
        }

        $size = @getimagesize($file->getRealPath());
        abort_unless($size !== false, 422, 'That file is not a readable image.');

        $path = $file->storeAs(
            self::DIRECTORY,
            $hash.'.'.($file->getMimeType() === 'image/jpeg' ? 'jpg' : 'png'),
            self::DISK,
        );

        $capture = ScreenshotSubmission::create([
            'user_id' => $request->user()->id,
            'org_id' => $request->user()->orgs()->value('orgs.id'),
            'status' => 'captured',
            'origin' => 'client',
            'image_path' => $path,
            'image_hash' => $hash,
            'mime' => $file->getMimeType(),
            'width' => $size[0],
            'height' => $size[1],
            'bytes' => $file->getSize(),
            'patch' => ($data['patch'] ?? null) ?: config('starbuddy.game_patch'),
            'submitter_note' => $data['note'] ?? null,
        ]);

        return response()->json($this->present($capture), 201);
    }

    /** The caller's own unlabelled captures, oldest first — it is a queue. */
    public function index(Request $request)
    {
        $captures = ScreenshotSubmission::where('user_id', $request->user()->id)
            ->where('status', 'captured')
            ->orderBy('created_at')
            ->paginate(24);

        return [
            'data' => $captures->getCollection()->map(fn ($c) => $this->present($c))->all(),
            'meta' => [
                'total' => $captures->total(),
                'per_page' => $captures->perPage(),
                'current_page' => $captures->currentPage(),
                'last_page' => $captures->lastPage(),
            ],
        ];
    }

    /**
     * Label a capture and send it for review.
     *
     * This is the same information the upload form collects; the difference is
     * only that the image arrived first.
     */
    public function contribute(Request $request, ScreenshotSubmission $submission)
    {
        $this->authorizeOwner($request, $submission);

        $data = $request->validate([
            'screen' => ['required', 'string', 'max:60'],
            'hud_colour' => ['required', Rule::in(TrainingLabels::HUD_COLOURS)],
            'hud_hex' => ['nullable', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'ship' => ['nullable', 'string', 'max:60'],
            'occluded' => ['required', 'boolean'],
            'submitter_note' => ['nullable', 'string', 'max:500'],
            'quad' => ['required', 'array', 'size:4'],
            'quad.*' => ['required', 'array', 'size:2'],
            'quad.*.*' => ['required', 'numeric', 'between:-0.5,1.5'],
        ]);

        $screen = TrainingLabels::normaliseName($data['screen']);
        abort_if($screen === '', 422, 'Give the screen a name using letters or numbers.');

        $quad = TrainingLabels::orderQuad(array_map(
            fn ($point) => [(float) $point[0], (float) $point[1]],
            $data['quad'],
        ));
        abort_if(
            TrainingLabels::area($quad) < self::MIN_QUAD_AREA,
            422,
            'Those four corners barely enclose anything. Mark the corners of the lit screen.',
        );

        $submission->update([
            'status' => 'pending',
            'screen' => $screen,
            'ship' => TrainingLabels::normaliseName($data['ship'] ?? '') ?: null,
            'hud_colour' => $data['hud_colour'],
            'hud_hex' => isset($data['hud_hex']) ? strtolower($data['hud_hex']) : null,
            'occluded' => $data['occluded'],
            'quad' => $quad,
            'submitter_note' => $data['submitter_note'] ?? $submission->submitter_note,
        ]);

        return $this->present($submission->fresh());
    }

    /** Throw a capture away, image and all. */
    public function destroy(Request $request, ScreenshotSubmission $submission)
    {
        $this->authorizeOwner($request, $submission);
        Storage::disk(self::DISK)->delete($submission->image_path);
        $submission->delete();

        return response()->noContent();
    }

    /**
     * Only the person who took a capture may see, label or discard it — and
     * only while it is still a capture. Once labelled it belongs to the review
     * flow, where a manager decides.
     */
    private function authorizeOwner(Request $request, ScreenshotSubmission $submission): void
    {
        abort_unless($submission->user_id === $request->user()->id, 403, 'That capture is not yours.');
        abort_unless($submission->status === 'captured', 422, 'That capture has already been submitted.');
    }

    /**
     * One row, whether or not it has been labelled yet.
     *
     * The label fields stay in the payload after `contribute` so the page can
     * show what it just sent without another round trip.
     *
     * @return array<string, mixed>
     */
    private function present(ScreenshotSubmission $capture): array
    {
        return [
            'id' => $capture->id,
            'status' => $capture->status,
            'origin' => $capture->origin,
            'patch' => $capture->patch,
            'width' => $capture->width,
            'height' => $capture->height,
            'bytes' => $capture->bytes,
            'image_url' => "/api/training/screenshots/{$capture->id}/image",
            'submitter_note' => $capture->submitter_note,
            'created_at' => $capture->created_at?->toIso8601String(),
            'screen' => $capture->screen,
            'ship' => $capture->ship,
            'hud_colour' => $capture->hud_colour,
            'hud_hex' => $capture->hud_hex,
            'occluded' => $capture->occluded,
            'quad' => $capture->quad,
        ];
    }
}
