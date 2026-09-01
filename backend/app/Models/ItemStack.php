<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ItemStack extends Model
{
    protected $fillable = [
        'user_id', 'org_id', 'location_id', 'item_class', 'item_name',
        'quality', 'quantity', 'visibility', 'source', 'craft_id',
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

        // Qualified: list sorts join `locations`, which has its own user_id.
        $userId = $query->qualifyColumn('user_id');
        $visibility = $query->qualifyColumn('visibility');

        return $query->where(function (Builder $q) use ($user, $orgMateIds, $userId, $visibility) {
            $q->where($userId, $user->id)
                ->orWhere(fn (Builder $q) => $q->where($visibility, 'org')->whereIn($userId, $orgMateIds));
        });
    }
}
