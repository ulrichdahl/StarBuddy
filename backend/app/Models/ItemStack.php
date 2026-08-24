<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ItemStack extends Model
{
    protected $fillable = [
        'user_id', 'org_id', 'location_id', 'item_class', 'item_name',
        'quantity', 'visibility', 'source',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function location(): BelongsTo
    {
        return $this->belongsTo(Location::class);
    }

    public function scopeVisibleTo(Builder $query, User $user): Builder
    {
        return $query->where(function (Builder $q) use ($user) {
            $q->where('user_id', $user->id)
                ->orWhere(function (Builder $q) use ($user) {
                    $q->where('visibility', 'org')
                        ->whereIn('org_id', $user->orgs()->pluck('orgs.id'));
                });
        });
    }
}
