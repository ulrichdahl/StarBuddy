<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ResourceType extends Model
{
    protected $fillable = [
        'name', 'category', 'unit', 'known_qualities', 'rarity', 'spawn_score',
        'scan_signature', 'mining_instability', 'mining_resistance', 'scan_profile',
    ];

    protected function casts(): array
    {
        return ['known_qualities' => 'array', 'scan_profile' => 'array'];
    }

    // Bootstrapping only: resources the game has no ladder for — salvage,
    // gases, the odd refined good — learn their values from entries. Once a
    // full ladder is known, entries must use it: nothing new is learned, which
    // is what keeps a mistyped quality from becoming a permanent band. Eight is
    // a full ladder, and a crafting material has nine with its dismantle 500,
    // so both are already at the limit the moment they are synced.
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
