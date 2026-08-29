<?php

namespace App\Console\Commands;

use App\Models\Item;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;

/**
 * Mirror the wiki's full items listing (~12k rows, ~125 pages of 100) into
 * the local `items` catalog so the item-entry autocomplete is instant and
 * works when the wiki is down. Upserts by uuid; rows the wiki drops are
 * kept — stacks may still reference them.
 */
class SyncItemCatalog extends Command
{
    protected $signature = 'starbuddy:sync-item-catalog {--pages= : Stop after this many pages (for testing)}';

    protected $description = 'Sync the game item catalog (names, classes, types) from the Star Citizen Wiki items API';

    private const API = 'https://api.star-citizen.wiki/api/v2/items';

    public function handle(): int
    {
        $maxPages = $this->option('pages') ? (int) $this->option('pages') : PHP_INT_MAX;
        $page = 1;
        $synced = 0;
        $skipped = 0;

        do {
            $response = Http::acceptJson()->retry(4, 3000)->timeout(30)->get(self::API, [
                'page[size]' => 100,
                'page[number]' => $page,
            ]);

            if (! $response->successful() || ! is_array($response->json('data'))) {
                $this->error("Wiki API returned {$response->status()} on page {$page} — stopping; {$synced} items synced so far.");

                return self::FAILURE;
            }

            $rows = [];
            foreach ($response->json('data') as $item) {
                $row = Item::fromWiki($item);
                if ($row === null) {
                    $skipped++;
                    continue;
                }
                // Two listings can carry the same uuid; last one wins.
                $rows[$row['uuid']] = $row;
            }
            if ($rows !== []) {
                Item::upsert(array_values($rows), ['uuid'], Item::SYNCED);
                $synced += count($rows);
            }

            $hasMore = (bool) $response->json('links.next') && $page < $maxPages;
            if ($hasMore) {
                usleep(300_000); // stay well under the API's rate limits
            }
            $page++;
        } while ($hasMore);

        $this->info("Item catalog: {$synced} items from ".($page - 1)." pages ({$skipped} placeholders skipped).");

        return self::SUCCESS;
    }
}
