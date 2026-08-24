<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Blueprint extends Model
{
    protected $fillable = ['name', 'item_class', 'tier', 'tags', 'game_version'];

    protected function casts(): array
    {
        return ['tags' => 'array'];
    }
}
