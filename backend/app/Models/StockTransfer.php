<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One handover of stock — materials or items — sold, or given for nothing.
 *
 * The stacks move (or vanish, when the buyer has no account), so this row is
 * the whole record. `lines` is a snapshot, not a link: what it says was true
 * when the stock changed hands, whatever became of the stack afterwards.
 */
class StockTransfer extends Model
{
    protected $fillable = [
        'user_id', 'org_id', 'stock', 'to_user_id', 'to_handle',
        'price', 'location_id', 'lines', 'note',
    ];

    protected function casts(): array
    {
        return ['lines' => 'array', 'price' => 'decimal:2'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function recipient(): BelongsTo
    {
        return $this->belongsTo(User::class, 'to_user_id');
    }

    public function location(): BelongsTo
    {
        return $this->belongsTo(Location::class);
    }
}
