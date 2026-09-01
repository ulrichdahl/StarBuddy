<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ScreenshotSubmission extends Model
{
    protected $fillable = [
        'user_id', 'org_id', 'status', 'image_path', 'image_hash', 'mime',
        'width', 'height', 'bytes', 'patch', 'ship', 'screen', 'hud_colour', 'hud_hex',
        'occluded', 'quad', 'submitter_note', 'review_note', 'reviewed_by',
        'reviewed_at', 'exported_at',
    ];

    protected function casts(): array
    {
        return [
            'quad' => 'array',
            'occluded' => 'boolean',
            'reviewed_at' => 'datetime',
            'exported_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function org(): BelongsTo
    {
        return $this->belongsTo(Org::class);
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }

    /**
     * Submissions a manager may act on: their own orgs' plus the ones from
     * members who belong to no org, which would otherwise never be reviewed.
     *
     * @param  array<int, int>  $orgIds
     */
    public function scopeReviewableBy(Builder $query, array $orgIds): Builder
    {
        return $query->where(function (Builder $q) use ($orgIds) {
            $q->whereIn('org_id', $orgIds)->orWhereNull('org_id');
        });
    }

    /**
     * The filename this capture gets inside an export, following the corpus
     * convention in screenshots/README.md.
     */
    public function exportFilename(int $sequence): string
    {
        $extension = $this->mime === 'image/jpeg' ? 'jpg' : 'png';
        $parts = array_filter([$this->patch, $this->ship, $this->screen]);

        return implode('-', $parts).'-'.$sequence.'.'.$extension;
    }

    /**
     * Captures that group as near-duplicates for train/validation splitting.
     *
     * One person shooting one screen in one patch tends to shoot it from the
     * same seat, so those belong on the same side of the split — otherwise the
     * model is validated against pictures it effectively trained on.
     */
    public function sessionKey(): string
    {
        return implode('-', [$this->user_id, $this->screen, $this->patch]);
    }
}
