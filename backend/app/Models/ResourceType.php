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

    // Remember every quality value seen for this resource; the entry UI
    // offers them back as quick-pick chips.
    public function learnQuality(int $quality): void
    {
        $known = $this->known_qualities ?? [];
        if (! in_array($quality, $known, true)) {
            $known[] = $quality;
            sort($known);
            $this->update(['known_qualities' => $known]);
        }
    }
}
