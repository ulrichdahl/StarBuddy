<?php

namespace App\Console\Commands;

use App\Models\ResourceType;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Seed per-resource quality bands from the community-datamined tables on
 * https://starcitizen.tools/Ore_quality (each resource has its own seven
 * band values plus the perfect 1000). Values are merged with what members
 * have entered — the wiki is authoritative, field data keeps us honest
 * between wiki updates.
 */
class SyncQualityBands extends Command
{
    protected $signature = 'starmaker:sync-quality-bands';

    protected $description = 'Seed per-resource quality bands from the Star Citizen Wiki Ore_quality page';

    private const API = 'https://starcitizen.tools/api.php';

    public function handle(): int
    {
        $response = Http::retry(3, 2000)->timeout(30)
            ->withHeaders(['User-Agent' => 'StarMaker/0.1 (self-hosted org tool)'])
            ->get(self::API, [
                'action' => 'parse',
                'page' => 'Ore_quality',
                'format' => 'json',
                'prop' => 'wikitext',
            ]);

        // The MediaWiki key is literally "*" — data_get would treat the
        // dotted path's asterisk as a wildcard, so index manually.
        $wikitext = $response->json()['parse']['wikitext']['*'] ?? null;
        if (! $wikitext) {
            $this->error('Could not fetch Ore_quality wikitext.');

            return self::FAILURE;
        }

        $updated = 0;
        foreach ($this->parseTables($wikitext) as $name => $bands) {
            // Bands apply to the material itself and its unrefined variants
            // (refining preserves quality through the primary ingredient).
            foreach ([$name, "{$name} (Ore)", "{$name} (Raw)"] as $candidate) {
                $type = ResourceType::whereLike('name', $candidate, caseSensitive: false)->first();
                if (! $type) {
                    continue;
                }
                $merged = collect([...$bands, ...($type->known_qualities ?? [])])
                    ->unique()->sort()->values()->all();
                $type->update(['known_qualities' => $merged]);
                $updated++;
            }
        }

        $this->info("Updated quality bands on {$updated} resource types.");

        return self::SUCCESS;
    }

    /** @return array<string, int[]> resource name => band values */
    private function parseTables(string $wikitext): array
    {
        $result = [];
        $name = null;
        $values = [];

        $flush = function () use (&$result, &$name, &$values) {
            if ($name !== null && count($values) >= 3) {
                $result[$name] = $values;
            }
            $name = null;
            $values = [];
        };

        foreach (preg_split('/\r?\n/', $wikitext) as $line) {
            $line = trim($line);
            if ($line === '|-' || $line === '|}') {
                $flush();
                continue;
            }
            if (! str_starts_with($line, '|') || str_starts_with($line, '|+')) {
                continue;
            }
            $cell = trim(substr($line, 1));
            if (preg_match('/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/', $cell, $m)) {
                $flush();
                $name = trim($m[1]);
            } elseif ($name !== null && is_numeric($cell)) {
                $v = (int) $cell;
                if ($v >= 1 && $v <= 1000) {
                    // The tables occasionally truncate "1000" — normalize.
                    $values[] = $v < 10 ? 1000 : $v;
                }
            }
        }
        $flush();

        return $result;
    }
}
