<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ItemStack extends Model
{
    protected $fillable = [
        'user_id', 'org_id', 'location_id', 'item_class', 'item_name',
        'quantity', 'visibility', 'source', 'craft_id',
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
        $orgMateIds = \Illuminate\Support\Facades\DB::table('org_members')
            ->whereIn('org_id', $user->orgs()->pluck('orgs.id'))
            ->where('status', 'active')
            ->pluck('user_id');

        return $query->where(function (Builder $q) use ($user, $orgMateIds) {
            $q->where('user_id', $user->id)
                ->orWhere(fn (Builder $q) => $q->where('visibility', 'org')->whereIn('user_id', $orgMateIds));
        });
    }
}
