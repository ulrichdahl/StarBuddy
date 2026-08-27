<?php

namespace App\Console\Commands;

use App\Models\ResourceType;
use App\Support\ScanSignatures;
use Illuminate\Console\Command;

/**
 * Copy the scan-signature reference (database/data/scan-signatures.json)
 * onto resource_types: every ore-category variant of a mineral ("Bexalite
 * (Raw)", "Bexalite (Ore)") gets its signature, instability, resistance and
 * composition profile. Re-run after editing the JSON for a game patch.
 */
class SyncScanSignatures extends Command
{
    protected $signature = 'starbuddy:sync-scan-signatures';

    protected $description = 'Attach radar signatures and mining stats from database/data/scan-signatures.json to resource types';

    public function handle(): int
    {
        $ref = ScanSignatures::reference();
        $updated = 0;
        $missing = [];
        foreach ($ref['ores'] as $ore) {
            $types = ResourceType::where('category', 'ore')
                ->where(fn ($q) => $q->where('name', $ore['name'])->orWhereLike('name', "{$ore['name']} (%"))
                ->get();
            if ($types->isEmpty()) {
                $missing[] = $ore['name'];
                continue;
            }
            foreach ($types as $type) {
                $type->update([
                    'scan_signature' => $ore['signature'],
                    'mining_instability' => $ore['instability'],
                    'mining_resistance' => $ore['resistance'],
                    'scan_profile' => ['dominant' => $ore['dominant'], 'companions' => $ore['companions']],
                ]);
                $updated++;
            }
        }
        $this->info("Signatures attached to {$updated} resource types (table patch {$ref['meta']['patch']}).");
        if ($missing) {
            $this->warn('No ore resource type for: '.implode(', ', $missing).' — run starbuddy:sync-resource-types first.');
        }

        return self::SUCCESS;
    }
}
