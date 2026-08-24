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

    // Stacks a user may see: their own, plus org-visible stacks in their orgs.
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
