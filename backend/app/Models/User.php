<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    protected $fillable = [
        'name', 'email', 'discord_id', 'discord_username', 'avatar_url', 'handle', 'locale',
    ];

    // The UDI link token is a bearer secret: only GET /api/me/udi-link hands it out.
    protected $hidden = ['password', 'remember_token', 'udi_link_token'];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'udi_link_token' => 'encrypted',
            'udi_linked_at' => 'datetime',
        ];
    }

    /**
     * The player's main org: where their points go and what the dashboard
     * shows. Kept valid: a player in any org always has one, and it is
     * always one of their active orgs.
     */
    public function mainOrg(): ?Org
    {
        return $this->main_org_id ? $this->orgs()->where('orgs.id', $this->main_org_id)->first() : null;
    }

    /** Repair main_org_id after a membership changed; returns it. */
    public function ensureMainOrg(): ?int
    {
        $active = $this->orgs()->orderBy('orgs.id')->pluck('orgs.id');
        $main = $active->contains($this->main_org_id) ? $this->main_org_id : $active->first();
        if ($main !== $this->main_org_id) {
            $this->forceFill(['main_org_id' => $main])->save();
        }

        return $main;
    }

    // Active memberships only — pending join requests don't grant access.
    public function orgs(): BelongsToMany
    {
        return $this->belongsToMany(Org::class, 'org_members')
            ->withPivot('role', 'status')
            ->wherePivot('status', 'active')
            ->withTimestamps();
    }

    public function orgMemberships(): BelongsToMany
    {
        return $this->belongsToMany(Org::class, 'org_members')
            ->withPivot('role', 'status')
            ->withTimestamps();
    }

    public function locations(): HasMany
    {
        return $this->hasMany(Location::class);
    }

    public function resourceStacks(): HasMany
    {
        return $this->hasMany(ResourceStack::class);
    }

    public function itemStacks(): HasMany
    {
        return $this->hasMany(ItemStack::class);
    }

    public function blueprintsOwned(): HasMany
    {
        return $this->hasMany(BlueprintOwned::class);
    }

    public function refineryOrders(): HasMany
    {
        return $this->hasMany(RefineryOrder::class);
    }

    public function isOrgOfficer(Org $org): bool
    {
        $membership = $this->orgs()->where('orgs.id', $org->id)->first();

        return $membership && in_array($membership->pivot->role, ['officer', 'admin', 'manager'], true);
    }
}
