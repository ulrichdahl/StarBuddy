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
        'name', 'email', 'discord_id', 'discord_username', 'avatar_url', 'handle',
    ];

    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
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
