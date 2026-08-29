<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * One row per game item known to the Star Citizen Wiki items API — the
 * catalog behind the item-entry autocomplete. Names, classes and labels
 * are game data and shown verbatim.
 */
class Item extends Model
{
    protected $fillable = [
        'uuid', 'name', 'class_name', 'type', 'type_label', 'sub_type', 'sub_type_label',
        'classification', 'manufacturer', 'size', 'grade', 'is_craftable',
    ];

    protected $casts = ['is_craftable' => 'bool', 'size' => 'int'];

    /** Columns the nightly sync refreshes on an existing row. */
    public const SYNCED = [
        'name', 'class_name', 'type', 'type_label', 'sub_type', 'sub_type_label',
        'classification', 'manufacturer', 'size', 'grade', 'is_craftable',
    ];

    /**
     * Map a wiki items-API payload onto a catalog row; null for entries
     * that are not real items (unnamed, or the wiki's "<= PLACEHOLDER =>"
     * stand-ins) so they never reach the autocomplete.
     */
    public static function fromWiki(array $item): ?array
    {
        $name = trim((string) ($item['name'] ?? ''));
        if ($name === '' || empty($item['uuid']) || str_starts_with($name, '<') || stripos($name, 'placeholder') !== false) {
            return null;
        }

        $undefined = fn ($v) => ($v === null || $v === '' || strcasecmp((string) $v, 'undefined') === 0) ? null : $v;

        return [
            'uuid' => $item['uuid'],
            'name' => $name,
            'class_name' => $undefined($item['class_name'] ?? null),
            'type' => $undefined($item['type'] ?? null),
            'type_label' => $undefined($item['type_label'] ?? null),
            'sub_type' => $undefined($item['sub_type'] ?? null),
            'sub_type_label' => $undefined($item['sub_type_label'] ?? null),
            'classification' => $undefined($item['classification'] ?? null),
            'manufacturer' => $undefined($item['manufacturer']['name'] ?? null),
            'size' => is_numeric($item['size'] ?? null) ? (int) $item['size'] : null,
            'grade' => $undefined($item['grade'] ?? null),
            'is_craftable' => (bool) ($item['is_craftable'] ?? false),
        ];
    }
}
