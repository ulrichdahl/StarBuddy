<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A mission reward pool a player is farming. */
class TrackedPool extends Model
{
    protected $fillable = ['user_id', 'blueprint_pool_id'];

    public function pool(): BelongsTo
    {
        return $this->belongsTo(BlueprintPool::class, 'blueprint_pool_id');
    }
}
