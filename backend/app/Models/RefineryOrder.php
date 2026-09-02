<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class RefineryOrder extends Model
{
    protected $fillable = [
        'user_id', 'station', 'location_id', 'method', 'work_order_number', 'state',
        'materials', 'unit', 'duration_seconds', 'cost', 'yield_total', 'capture',
        'placed_at', 'eta', 'completed_at', 'collected_at', 'collected_location_id', 'source',
    ];

    protected function casts(): array
    {
        return [
            'materials' => 'array',
            'capture' => 'array',
            'cost' => 'float',
            'yield_total' => 'float',
            'placed_at' => 'datetime',
            'eta' => 'datetime',
            'completed_at' => 'datetime',
            'collected_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** The refinery itself, so its yields have somewhere to sit. */
    public function location(): BelongsTo
    {
        return $this->belongsTo(Location::class);
    }

    /** Where the materials went when they were collected. */
    public function collectedLocation(): BelongsTo
    {
        return $this->belongsTo(Location::class, 'collected_location_id');
    }

    /**
     * The stacks this order is producing.
     *
     * They exist from the moment the order is recorded — marked as refining and
     * sitting at the refinery — so the materials show up in the lists while the
     * job runs rather than appearing out of nowhere at the end.
     */
    public function stacks(): HasMany
    {
        return $this->hasMany(ResourceStack::class);
    }

    /** Still refining: recorded, and nobody has collected it yet. */
    public function isOpen(): bool
    {
        return $this->collected_at === null;
    }
}
