<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A point a player marked in the game, set from the desktop client: a
 * position in one coordinate frame (a planet's turning frame, or the star
 * system's for a beacon in space) on one game shard.
 */
class Beacon extends Model
{
    protected $fillable = [
        'user_id', 'name', 'shard', 'frame', 'pos_x', 'pos_y', 'pos_z',
        'system', 'location', 'server', 'set_at', 'shared',
    ];

    protected function casts(): array
    {
        return [
            'pos_x' => 'float',
            'pos_y' => 'float',
            'pos_z' => 'float',
            'set_at' => 'datetime',
            'shared' => 'boolean',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** As the API and the client see it, for the given viewer. */
    public function present(User $viewer): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'shard' => $this->shard,
            'frame' => $this->frame,
            'pos' => [$this->pos_x, $this->pos_y, $this->pos_z],
            'system' => $this->system,
            'location' => $this->location,
            'server' => $this->server,
            'set_at' => $this->set_at?->toIso8601String(),
            'shared' => $this->shared,
            'mine' => $this->user_id === $viewer->id,
            'owner' => ['id' => $this->user_id, 'name' => $this->user?->handle ?? $this->user?->name],
        ];
    }
}
