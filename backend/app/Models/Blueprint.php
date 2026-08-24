<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Blueprint extends Model
{
    protected $fillable = [
        'name', 'item_class', 'tier', 'tags', 'game_version',
        'uuid', 'key', 'type', 'sub_type', 'grade', 'is_default',
        'craft_time_seconds', 'ingredients', 'dismantle_returns',
    ];

    protected function casts(): array
    {
        return [
            'tags' => 'array',
            'ingredients' => 'array',
            'dismantle_returns' => 'array',
            'is_default' => 'boolean',
        ];
    }
}
