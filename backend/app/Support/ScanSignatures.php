<?php

namespace App\Support;

use App\Models\ResourceType;

/**
 * Scan-signature reference: what a radar signature read off the scanner
 * means. Since Alpha 4.7 every ship-mineable mineral has a fixed base
 * signature and the scanner shows the sum over the pinged cluster
 * (18,000 = 5 × Bexalite 3,600). Ground deposits encode only their size
 * (3,000 hand, 4,000 ROC). The table lives in database/data/scan-signatures.json,
 * is synced onto resource_types and served to the client, which does the
 * same matching offline.
 */
class ScanSignatures
{
    public const FILE = 'data/scan-signatures.json';

    /** Rocks per cluster we still consider (larger sums are noise). */
    public const MAX_COUNT = 12;

    /** OCR tolerance for approximate matches, as a fraction of the value. */
    public const TOLERANCE = 0.01;

    public static function reference(): array
    {
        $json = json_decode(file_get_contents(database_path(self::FILE)), true, 512, JSON_THROW_ON_ERROR);

        return [
            'meta' => $json['_meta'] ?? [],
            'ground' => $json['ground'] ?? [],
            'ores' => $json['ores'] ?? [],
        ];
    }

    /**
     * The table as served: reference values plus what the database knows
     * about each mineral (rarity, quality bands) — one row per mineral,
     * keyed to the raw-ore resource type when one exists.
     */
    public static function table(): array
    {
        $ref = self::reference();
        $types = ResourceType::whereNotNull('scan_signature')->get()
            ->groupBy(fn ($t) => self::baseName($t->name));

        $ores = [];
        foreach ($ref['ores'] as $ore) {
            $matches = $types->get($ore['name'], collect());
            // Prefer the ore variant that carries a rarity ("Bexalite (Raw)"
            // has one, the legacy "Bexalite (Ore)" row does not).
            $type = $matches->first(fn ($t) => $t->category === 'ore' && $t->rarity !== null)
                ?? $matches->firstWhere('category', 'ore')
                ?? $matches->first();
            $ores[] = [
                ...$ore,
                'resource_type_id' => $type?->id,
                'resource_name' => $type?->name,
                'rarity' => $type?->rarity,
                'qualities' => $type?->known_qualities ?? [],
            ];
        }

        return ['meta' => $ref['meta'], 'ground' => $ref['ground'], 'ores' => $ores];
    }

    /**
     * Candidate readings for a signature value: exact multiples (fewest
     * rocks first); only when nothing is exact, near misses within
     * TOLERANCE — the OCR occasionally slips a digit. Base signatures sit
     * as close as 15 apart, so approximate matches never compete with an
     * exact one.
     *
     * @return list<array{name:string,kind:string,count:int,signature:int,exact:bool,delta:int}>
     */
    public static function match(float $value, ?array $table = null): array
    {
        $table ??= self::reference();
        if ($value <= 0) {
            return [];
        }
        $candidates = [];
        foreach ($table['ores'] as $ore) {
            $candidates[] = ['name' => $ore['name'], 'kind' => 'ship', 'base' => (int) $ore['signature']];
        }
        foreach ($table['ground'] as $kind => $base) {
            $candidates[] = ['name' => $kind, 'kind' => $kind, 'base' => (int) $base];
        }

        $out = [];
        foreach ($candidates as $c) {
            $count = (int) round($value / $c['base']);
            if ($count < 1 || $count > self::MAX_COUNT) {
                continue;
            }
            $delta = (int) round($value - $count * $c['base']);
            if (abs($delta) > $value * self::TOLERANCE) {
                continue;
            }
            $out[] = [
                'name' => $c['name'],
                'kind' => $c['kind'],
                'count' => $count,
                'signature' => $c['base'],
                'exact' => $delta === 0,
                'delta' => $delta,
            ];
        }
        if (array_filter($out, fn ($m) => $m['exact'])) {
            $out = array_values(array_filter($out, fn ($m) => $m['exact']));
        }
        usort($out, fn ($a, $b) => [$a['count'], abs($a['delta'])] <=> [$b['count'], abs($b['delta'])]);

        return $out;
    }

    /** "Bexalite (Raw)" / "Bexalite (Ore)" / "Hephaestanite (R)" → "Bexalite". */
    public static function baseName(string $name): string
    {
        return trim(preg_replace('/\s*\([^)]*\)\s*$/', '', $name));
    }
}
