<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ResourceStack extends Model
{
    protected $fillable = [
        'user_id', 'org_id', 'location_id', 'resource_type_id',
        'quality', 'quantity', 'visibility', 'source', 'updated_by',
    ];

    // The API speaks unit-explicit names (quantity_mscu / quantity_pieces);
    // storage is a single integer whose unit lives on the resource type.
    protected $appends = ['quantity_mscu', 'quantity_pieces'];

    public function getQuantityMscuAttribute(): ?int
    {
        return $this->resourceType?->unit === 'mscu' ? $this->quantity : null;
    }

    public function getQuantityPiecesAttribute(): ?int
    {
        return $this->resourceType?->unit === 'pieces' ? $this->quantity : null;
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function location(): BelongsTo
    {
        return $this->belongsTo(Location::class);
    }

    public function resourceType(): BelongsTo
    {
        return $this->belongsTo(ResourceType::class);
    }

    // Stacks a user may see: their own, plus org-visible stacks belonging to
    // current active members of their orgs (membership-based, so joining an
    // org immediately pools your existing org-visible stock).
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
