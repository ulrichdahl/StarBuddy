<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AuditLog extends Model
{
    protected $fillable = ['user_id', 'org_id', 'action', 'details'];

    protected function casts(): array
    {
        return ['details' => 'array'];
    }
}
