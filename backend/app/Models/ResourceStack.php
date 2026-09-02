<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ResourceStack extends Model
{
    protected $fillable = [
        'user_id', 'org_id', 'location_id', 'resource_type_id',
        'quality', 'quantity', 'visibility', 'source', 'updated_by', 'refinery_order_id',
    ];

    // The API speaks unit-explicit names (quantity_mscu / quantity_pieces);
    // storage is a single integer whose unit lives on the resource type.
    protected $appends = ['quantity_mscu', 'quantity_pieces', 'refining', 'refining_at'];

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

    public function refineryOrder(): BelongsTo
    {
        return $this->belongsTo(RefineryOrder::class);
    }

    /**
     * Whether the refinery still has this material.
     *
     * A refining stack counts towards what the player owns — it is theirs, it
     * is just not in hand yet — so it stays in the materials and craft lists,
     * marked, rather than being hidden until collection.
     */
    public function getRefiningAttribute(): bool
    {
        return $this->refinery_order_id !== null && $this->refineryOrder?->collected_at === null;
    }

    /** Which refinery is holding it, for the marker's tooltip. */
    public function getRefiningAtAttribute(): ?string
    {
        return $this->refining ? $this->refineryOrder?->station : null;
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

        // Qualified: list sorts join `locations`, which has its own user_id.
        $userId = $query->qualifyColumn('user_id');
        $visibility = $query->qualifyColumn('visibility');

        return $query->where(function (Builder $q) use ($user, $orgMateIds, $userId, $visibility) {
            $q->where($userId, $user->id)
                ->orWhere(fn (Builder $q) => $q->where($visibility, 'org')->whereIn($userId, $orgMateIds));
        });
    }
}
