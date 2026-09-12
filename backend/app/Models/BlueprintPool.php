<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A weighted set of blueprints the game draws from when a mission pays out.
 *
 * Game data: written only by starbuddy:sync-blueprint-pools.
 */
class BlueprintPool extends Model
{
    protected $fillable = ['key', 'record', 'sources'];

    protected function casts(): array
    {
        return ['sources' => 'array'];
    }

    public function entries(): HasMany
    {
        return $this->hasMany(BlueprintPoolEntry::class);
    }

    /**
     * A readable name for the pool, since the game only gives it a record key.
     *
     * The record keeps its original casing where the key is lowercased, so
     * BP_MISSIONREWARD_HeadHunters_MercenaryFPS_EliminateALL reads as
     * "HeadHunters Mercenary FPS Eliminate ALL" rather than one long word.
     */
    public function label(): string
    {
        $name = str_replace('BlueprintPoolRecord.', '', (string) ($this->record ?: $this->key));
        $name = preg_replace('/^bp_(missionreward|rewards?)_/i', '', $name);
        $name = str_replace('_', ' ', (string) $name);
        // A capital after a lowercase letter starts a new word; a run of
        // capitals (FPS, ALL, AB) is left whole.
        $name = preg_replace('/(?<=[a-z0-9])(?=[A-Z])/', ' ', $name);

        return trim((string) $name);
    }
}
