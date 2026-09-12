<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One blueprint's place in one pool, and its share of the draw. */
class BlueprintPoolEntry extends Model
{
    protected $fillable = ['blueprint_pool_id', 'blueprint_id', 'blueprint_key', 'weight'];

    protected function casts(): array
    {
        return ['weight' => 'float'];
    }

    public function pool(): BelongsTo
    {
        return $this->belongsTo(BlueprintPool::class, 'blueprint_pool_id');
    }

    public function blueprint(): BelongsTo
    {
        return $this->belongsTo(Blueprint::class);
    }
}
