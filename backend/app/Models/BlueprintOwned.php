<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BlueprintOwned extends Model
{
    protected $table = 'blueprint_owned';

    protected $fillable = ['user_id', 'blueprint_id', 'blueprint_name', 'acquired_at', 'source'];

    protected function casts(): array
    {
        return ['acquired_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function blueprint(): BelongsTo
    {
        return $this->belongsTo(Blueprint::class);
    }
}
