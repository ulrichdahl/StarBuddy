<?php

namespace App\Console\Commands;

use App\Models\Blueprint;
use App\Support\WikiItem;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;

/**
 * Enrich every recipe's output item from the wiki items listing in bulk:
 * classification, component class, lore, image, and stat blocks. The
 * listing carries the full item payload, so one paced pass over the
 * craftable items of each blueprint type covers all recipes without
 * per-item requests.
 */
class SyncItems extends Command
{
    protected $signature = 'starbuddy:sync-items {--type= : Only this item type}';

    protected $description = 'Enrich blueprint output items (classification, class, stats) from the Star Citizen Wiki items API';

    private const API = 'https://api.star-citizen.wiki/api/v2/items';

    public function handle(): int
    {
        $types = $this->option('type')
            ? [$this->option('type')]
            : Blueprint::whereNotNull('type')->distinct()->orderBy('type')->pluck('type')->all();

        $byUuid = Blueprint::whereNotNull('item_uuid')->pluck('id', 'item_uuid');
        $byClass = Blueprint::whereNotNull('item_class')
            ->pluck('id', 'item_class')
            ->mapWithKeys(fn ($id, $class) => [Blueprint::normalizeClass($class) => $id]);

        $updated = 0;
        $requests = 0;
        foreach ($types as $type) {
            $page = 1;
            do {
                $response = Http::acceptJson()->retry(4, 3000)->timeout(30)->get(self::API, [
                    'filter[type]' => $type,
                    'filter[is_craftable]' => 1,
                    'page[size]' => 100,
                    'page[number]' => $page,
                ]);
                $requests++;

                if (! $response->successful() || ! is_array($response->json('data'))) {
                    $this->warn("Wiki API returned {$response->status()} for {$type} page {$page} — skipping type");
                    break;
                }

                foreach ($response->json('data') as $item) {
                    $id = $byUuid[$item['uuid'] ?? ''] ?? $byClass[Blueprint::normalizeClass($item['class_name'] ?? '')] ?? null;
                    if ($id === null) {
                        continue;
                    }
                    Blueprint::whereKey($id)->update(WikiItem::attributes($item));
                    $updated++;
                }

                $hasMore = (bool) $response->json('links.next');
                $page++;
                usleep(300_000); // stay well under the API's rate limits
            } while ($hasMore);

            $this->line("  {$type}: done");
        }

        $this->info("Enriched {$updated} blueprints from {$requests} item pages.");

        return self::SUCCESS;
    }
}
