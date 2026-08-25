<?php

namespace App\Console\Commands;

use App\Models\Blueprint;
use App\Models\ResourceType;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Sync the resource catalog from the Star Citizen Wiki commodities API so
 * imports and quick entry always know every resource in the game — the
 * hand-seeded list fell behind the moment a patch added materials.
 *
 * Classification: the display_name's trailing tag drives the category;
 * gems are whatever recipes consume by pieces.
 */
class SyncResourceTypes extends Command
{
    protected $signature = 'starbuddy:sync-resource-types';

    // Pre-rename name, kept so old habits and scripts keep working.
    protected $aliases = ['starmaker:sync-resource-types'];

    protected $description = 'Sync resource types from the Star Citizen Wiki commodities API';

    private const API = 'https://api.star-citizen.wiki/api/commodities';

    private const TAG_CATEGORY = [
        'UnrefinedOres' => 'ore',
        'Raw_Minerals' => 'ore',
        'Metal' => 'refined',
        'Mineral' => 'refined',
        'Nonmetal' => 'refined',
        'Alloy' => 'refined',
        'Halogen' => 'refined',
        'Gas' => 'gas',
    ];

    public function handle(): int
    {
        // Names recipes consume by pieces (gems) or by SCU, straight from
        // the synced blueprint ingredients.
        $pieceNames = [];
        $scuNames = [];
        Blueprint::whereNotNull('ingredients')->pluck('ingredients')->each(function ($ingredients) use (&$pieceNames, &$scuNames) {
            foreach ($ingredients as $ing) {
                if (! empty($ing['quantity_pieces'])) {
                    $pieceNames[Str::lower($ing['name'])] = $ing['name'];
                } elseif (! empty($ing['quantity_mscu'])) {
                    $scuNames[Str::lower($ing['name'])] = $ing['name'];
                }
            }
        });

        $synced = 0;
        $page = 1;

        do {
            $response = Http::acceptJson()->retry(3, 2000)->timeout(30)
                ->get(self::API, ['limit' => 100, 'page' => $page]);

            if (! $response->successful()) {
                $this->error("Wiki API returned {$response->status()} on page {$page}");

                return self::FAILURE;
            }

            foreach ($response->json('data', []) as $c) {
                $name = trim($c['name'] ?? '');
                if ($name === '') {
                    continue;
                }

                preg_match('/\(([^)]+)\)\s*$/', $c['display_name'] ?? '', $m);
                $tag = $m[1] ?? null;

                $isGem = isset($pieceNames[Str::lower($name)]);
                $category = $isGem ? 'gem' : (self::TAG_CATEGORY[$tag] ?? null);

                // Salvage streams hide among ProcessedGoods; the rest of that
                // tag (helmets, trade goods) is not a crafting resource.
                if ($category === null && $tag === 'ProcessedGoods'
                    && Str::contains($name, ['Construction', 'Recycled'])) {
                    $category = 'salvage';
                }
                // Anything a recipe consumes is a resource, whatever its tag.
                if ($category === null && isset($scuNames[Str::lower($name)])) {
                    $category = 'refined';
                }
                if ($category === null) {
                    continue;
                }

                ResourceType::updateOrCreate(
                    ['name' => $name],
                    ['category' => $category, 'unit' => $isGem ? 'pieces' : 'mscu'],
                );
                $synced++;
            }

            $hasMore = (bool) $response->json('links.next');
            $page++;
        } while ($hasMore);

        // Recipe ingredients not present as commodities still need entries.
        foreach ($pieceNames as $name) {
            ResourceType::firstOrCreate(['name' => $name], ['category' => 'gem', 'unit' => 'pieces', 'known_qualities' => []]);
        }
        foreach ($scuNames as $name) {
            ResourceType::firstOrCreate(['name' => $name], ['category' => 'refined', 'unit' => 'mscu', 'known_qualities' => []]);
        }

        $this->info("Synced {$synced} resource types (total now ".ResourceType::count().').');

        return self::SUCCESS;
    }
}
