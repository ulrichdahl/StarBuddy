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
        // member: player handle, empty = yourself (importing for others needs
        // an officer role). unit: SCU, cSCU (0.01 SCU), mSCU (0.001 SCU), or
        // pieces for gems; empty = mSCU.
        $csv = "member,location,resource,quality,quantity,unit,visibility\n"
            .",New Babbage,Iron,874,2.5,SCU,org\n"
            ."DK-Raven,Levski,Gold,644,120,cSCU,org\n"
            .",Levski,Hadanite,10,34,pieces,private\n";

        return response($csv, 200, [
            'Content-Type' => 'text/csv',
            'Content-Disposition' => 'attachment; filename="starbuddy-resources-template.csv"',
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

        // Org mates, matchable by handle (preferred) or Discord username.
        $members = $request->user()->orgs()
            ->with('members')
            ->get()
            ->flatMap(fn ($org) => $org->members)
            ->push($request->user())
            ->unique('id');
        $byHandle = $members->filter(fn ($m) => $m->handle)->keyBy(fn ($m) => Str::lower($m->handle));
        $byName = $members->keyBy(fn ($m) => Str::lower($m->name));

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

            // Quantities convert to storage units: integer mSCU for crated
            // resources, whole pieces for gems.
            $unitRaw = Str::of($record['unit'] ?? '')->lower()->trim()->toString();
            $raw = filter_var($record['quantity'] ?? null, FILTER_VALIDATE_FLOAT);
            $quantity = null;

            if ($raw === false || $raw <= 0) {
                $errors[] = 'Quantity must be a positive number';
            } elseif ($type?->unit === 'pieces') {
                if (! in_array($unitRaw, ['', 'pieces', 'piece'], true)) {
                    $errors[] = "\"{$type->name}\" is counted in pieces, not {$record['unit']}";
                } elseif (fmod($raw, 1) !== 0.0) {
                    $errors[] = 'Pieces must be a whole number';
                } else {
                    $quantity = (int) $raw;
                }
            } else {
                $factor = match ($unitRaw) {
                    '', 'mscu' => 1,
                    'cscu' => 10,
                    'scu' => 1000,
                    default => null,
                };
                if ($factor === null) {
                    $errors[] = 'Unit must be SCU, cSCU, mSCU or pieces';
                } else {
                    $mscu = $raw * $factor;
                    if (abs($mscu - round($mscu)) > 1e-6) {
                        $errors[] = 'Quantity is finer than 0.001 SCU — not storable as crates';
                    } else {
                        $quantity = (int) round($mscu);
                    }
                }
            }

            if (($record['location'] ?? '') === '') {
                $errors[] = 'Location is required';
            }

            $visibility = Str::lower($record['visibility'] ?? '') ?: 'private';
            if (! in_array($visibility, ['private', 'org'], true)) {
                $errors[] = 'Visibility must be private or org';
            }

            $memberName = trim($record['member'] ?? '');
            $target = $memberName === ''
                ? $request->user()
                : ($byHandle[Str::lower($memberName)] ?? $byName[Str::lower($memberName)] ?? null);
            if (! $target) {
                $errors[] = "Unknown member \"{$memberName}\" — no org mate with that handle";
            }

            $rows[] = [
                'line' => $line,
                'data' => [
                    'member' => $memberName !== '' ? $memberName : ($request->user()->handle ?? $request->user()->name),
                    'user_id' => $target?->id,
                    'location' => $record['location'] ?? '',
                    'resource' => $record['resource'] ?? '',
                    'resource_type_id' => $type?->id,
                    'quality' => $quality === false ? null : $quality,
                    'quantity' => $quantity,
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

        // Importing on someone else's behalf is an officer action.
        $importsForOthers = collect($rows)
            ->filter(fn ($r) => ! $r['errors'])
            ->contains(fn ($r) => ($r['data']['user_id'] ?? $user->id) !== $user->id);
        if ($importsForOthers) {
            $org = $user->orgs()->first();
            abort_unless($org && $user->isOrgOfficer($org), 403, 'Importing for other members requires an officer role.');
        }

        $imported = 0;

        DB::transaction(function () use ($rows, $user, $orgId, &$imported) {
            $locations = [];

            foreach ($rows as $row) {
                if ($row['errors']) {
                    continue;
                }
                $d = $row['data'];
                $targetId = $d['user_id'] ?? $user->id;

                // Reuse a shared landing zone of that name before creating a
                // personal location for the target member.
                $locKey = $targetId.'|'.Str::lower($d['location']);
                $locations[$locKey] ??= (
                    Location::whereRaw('lower(name) = ?', [Str::lower($d['location'])])
                        ->where(fn ($q) => $q->whereNull('user_id')->orWhere('user_id', $targetId))
                        ->value('id')
                    ?? Location::create(['user_id' => $targetId, 'name' => $d['location'], 'kind' => 'other'])->id
                );

                ResourceStack::create([
                    'user_id' => $targetId,
                    'org_id' => $orgId,
                    'location_id' => $locations[$locKey],
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
