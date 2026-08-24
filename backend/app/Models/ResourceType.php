<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ResourceType extends Model
{
    protected $fillable = ['name', 'category', 'unit', 'known_qualities', 'rarity', 'spawn_score'];

    protected function casts(): array
    {
        return ['known_qualities' => 'array'];
    }

    // Bootstrapping only: resources without their wiki band ladder learn
    // values from entries. Once a full ladder (8 bands) is known, entries
    // must use it — nothing new is learned, keeping the bands canonical.
    public function learnQuality(int $quality): void
    {
        $known = $this->known_qualities ?? [];
        if (count($known) >= 8 || in_array($quality, $known, true)) {
            return;
        }
        $known[] = $quality;
        sort($known);
        $this->update(['known_qualities' => $known]);
    }
}
