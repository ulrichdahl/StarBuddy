<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Location;
use App\Models\ResourceStack;
use App\Models\ResourceType;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use League\Csv\Reader;

/**
 * P1.1 — CSV import of existing org resources.
 *
 * Flow: POST /preview (multipart csv) validates every row and caches the
 * parsed result under a token; the client shows the preview; POST /commit
 * with that token writes the valid rows in one transaction. Nothing is
 * persisted at preview time.
 *
 * Columns: location, resource, quality, quantity, unit? (crates|pieces),
 * visibility? (private|org). Unknown locations are created for the importer;
 * resources must exist in resource_types.
 */
class ImportController extends Controller
{
    private const COLUMNS = ['location', 'resource', 'quality', 'quantity'];

    public function template()
    {
        $csv = "location,resource,quality,quantity,unit,visibility\n"
            ."Hangar New Babbage,Iron,874,25,crates,org\n"
            ."Hangar New Babbage,Gold,644,12,crates,org\n"
            ."Freight Elevator Levski,Hadanite,0,34,pieces,private\n";

        return response($csv, 200, [
            'Content-Type' => 'text/csv',
            'Content-Disposition' => 'attachment; filename="starmaker-resources-template.csv"',
        ]);
    }

    public function preview(Request $request)
    {
        $request->validate(['file' => ['required', 'file', 'mimes:csv,txt', 'max:5120']]);

        $csv = Reader::createFromPath($request->file('file')->getRealPath());
        $csv->setHeaderOffset(0);

        $header = array_map(fn ($h) => Str::of($h)->lower()->trim()->toString(), $csv->getHeader());
        $missing = array_diff(self::COLUMNS, $header);
        if ($missing) {
            return response()->json([
                'message' => 'Missing required columns: '.implode(', ', $missing),
            ], 422);
        }

        $types = ResourceType::all()->keyBy(fn ($t) => Str::lower($t->name));
        $rows = [];
        $validCount = 0;

        foreach ($csv->getRecords($header) as $line => $record) {
            $record = array_map(fn ($v) => is_string($v) ? trim($v) : $v, $record);
            $errors = [];

            $type = $types->get(Str::lower($record['resource'] ?? ''));
            if (! $type) {
                $errors[] = "Unknown resource \"{$record['resource']}\"";
            }

            $quality = filter_var($record['quality'] ?? null, FILTER_VALIDATE_INT);
            if ($quality === false || $quality < 0 || $quality > 1000) {
                $errors[] = 'Quality must be an integer 0–1000';
            }

            $quantity = filter_var($record['quantity'] ?? null, FILTER_VALIDATE_INT);
            if ($quantity === false || $quantity < 1) {
                $errors[] = 'Quantity must be a positive integer';
            }

            if (($record['location'] ?? '') === '') {
                $errors[] = 'Location is required';
            }

            $visibility = Str::lower($record['visibility'] ?? '') ?: 'private';
            if (! in_array($visibility, ['private', 'org'], true)) {
                $errors[] = 'Visibility must be private or org';
            }

            $rows[] = [
                'line' => $line,
                'data' => [
                    'location' => $record['location'] ?? '',
                    'resource' => $record['resource'] ?? '',
                    'resource_type_id' => $type?->id,
                    'quality' => $quality === false ? null : $quality,
                    'quantity' => $quantity === false ? null : $quantity,
                    'unit' => $type?->unit,
                    'visibility' => $visibility,
                ],
                'errors' => $errors,
            ];

            if (! $errors) {
                $validCount++;
            }

            if (count($rows) >= 2000) {
                return response()->json(['message' => 'Import limited to 2000 rows per file.'], 422);
            }
        }

        $token = Str::uuid()->toString();
        Cache::put("import:{$request->user()->id}:{$token}", $rows, now()->addMinutes(30));

        return [
            'token' => $token,
            'rows' => $rows,
            'valid_count' => $validCount,
            'error_count' => count($rows) - $validCount,
        ];
    }

    public function commit(Request $request)
    {
        $request->validate(['token' => ['required', 'uuid']]);

        $key = "import:{$request->user()->id}:{$request->input('token')}";
        $rows = Cache::pull($key);
        abort_if($rows === null, 410, 'Import preview expired — upload the file again.');

        $user = $request->user();
        $orgId = $user->orgs()->value('orgs.id');
        $imported = 0;

        DB::transaction(function () use ($rows, $user, $orgId, &$imported) {
            $locations = [];

            foreach ($rows as $row) {
                if ($row['errors']) {
                    continue;
                }
                $d = $row['data'];

                $locations[$d['location']] ??= Location::firstOrCreate(
                    ['user_id' => $user->id, 'name' => $d['location']],
                    ['kind' => 'other'],
                )->id;

                ResourceStack::create([
                    'user_id' => $user->id,
                    'org_id' => $orgId,
                    'location_id' => $locations[$d['location']],
                    'resource_type_id' => $d['resource_type_id'],
                    'quality' => $d['quality'],
                    'quantity' => $d['quantity'],
                    'visibility' => $d['visibility'],
                    'source' => 'import',
                    'updated_by' => $user->id,
                ]);

                ResourceType::find($d['resource_type_id'])->learnQuality($d['quality']);
                $imported++;
            }
        });

        AuditLog::create([
            'user_id' => $user->id,
            'org_id' => $orgId,
            'action' => 'import.resources',
            'details' => ['imported' => $imported, 'skipped' => count($rows) - $imported],
        ]);

        return ['imported' => $imported, 'skipped' => count($rows) - $imported];
    }
}
