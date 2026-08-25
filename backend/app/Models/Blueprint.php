<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Blueprint extends Model
{
    protected $fillable = [
        'name', 'item_class', 'tier', 'tags', 'game_version',
        'uuid', 'key', 'type', 'sub_type', 'grade', 'is_default',
        'craft_time_seconds', 'ingredients', 'dismantle_returns',
        'description', 'image_url', 'manufacturer', 'item_meta',
        'item_uuid', 'type_label', 'sub_type_label', 'classification', 'component_class',
    ];

    protected function casts(): array
    {
        return [
            'tags' => 'array',
            'ingredients' => 'array',
            'dismantle_returns' => 'array',
            'is_default' => 'boolean',
            'item_meta' => 'array',
        ];
    }

    /**
     * Canonical form for item-class comparison: the wiki's classes carry a
     * `_scitem` suffix that the localization keys (the client's source)
     * don't, and casing differs between the two.
     */
    public static function normalizeClass(?string $class): ?string
    {
        if ($class === null) {
            return null;
        }
        $c = strtolower(trim($class));

        return str_ends_with($c, '_scitem') ? substr($c, 0, -7) : $c;
    }
}
