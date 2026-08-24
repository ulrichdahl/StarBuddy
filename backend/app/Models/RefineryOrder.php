<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RefineryOrder extends Model
{
    protected $fillable = [
        'user_id', 'station', 'method', 'materials',
        'placed_at', 'eta', 'completed_at', 'source',
    ];

    protected function casts(): array
    {
        return [
            'materials' => 'array',
            'placed_at' => 'datetime',
            'eta' => 'datetime',
            'completed_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
