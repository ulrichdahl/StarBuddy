<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Org extends Model
{
    protected $fillable = ['name', 'sid', 'discord_role_id'];

    public function members(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'org_members')
            ->withPivot('role', 'status')
            ->wherePivot('status', 'active')
            ->withTimestamps();
    }

    public function memberships(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'org_members')
            ->withPivot('role', 'status')
            ->withTimestamps();
    }
}
