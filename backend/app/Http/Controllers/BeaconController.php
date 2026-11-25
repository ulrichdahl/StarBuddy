<?php

namespace App\Http\Controllers;

use App\Models\Beacon;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Location beacons: points players mark in the game from the desktop client
 * and steer back to. A player sees their own and the ones members of their
 * orgs share. The website lists, renames, shares, deletes and moves them
 * between players outside an org as a JSON file (export is client-side,
 * import is here).
 */
class BeaconController extends Controller
{
    /** What an export file says it is. */
    public const FORMAT = 'starbuddy-beacons';

    public const VERSION = 1;

    /** Enough for any player; stops a runaway client or a bad import file. */
    public const MAX_PER_USER = 1000;

    /** GET /api/beacons: the player's own, then org mates' shared ones; newest first. */
    public function index(Request $request)
    {
        $user = $request->user();
        $mateIds = DB::table('org_members')
            ->whereIn('org_id', $user->orgs()->pluck('orgs.id'))
            ->where('status', 'active')
            ->where('user_id', '!=', $user->id)
            ->pluck('user_id');

        $beacons = Beacon::with('user:id,name,handle')
            ->where(fn ($q) => $q->where('user_id', $user->id)
                ->orWhere(fn ($q) => $q->where('shared', true)->whereIn('user_id', $mateIds)))
            ->orderByRaw('case when user_id = ? then 0 else 1 end', [$user->id])
            ->orderByDesc('set_at')
            ->orderByDesc('id')
            ->get();

        return ['data' => $beacons->map(fn (Beacon $b) => $b->present($user))->values()];
    }

    /** POST /api/beacons, from the client when the player sets one. */
    public function store(Request $request)
    {
        $user = $request->user();
        $data = $request->validate($this->beaconRules('') + ['shared' => ['nullable', 'boolean']]);
        $this->guardCount($user, 1);

        $beacon = Beacon::create($this->attributes($data) + [
            'user_id' => $user->id,
            'shared' => (bool) ($data['shared'] ?? false),
        ]);

        return response()->json(['data' => $beacon->setRelation('user', $user)->present($user)], 201);
    }

    /** PATCH /api/beacons/{beacon}: rename, or share with the org. Owner only. */
    public function update(Request $request, Beacon $beacon)
    {
        $user = $request->user();
        abort_unless($beacon->user_id === $user->id, 403, 'Only the player who set a beacon can change it.');
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:80'],
            'shared' => ['sometimes', 'boolean'],
        ]);
        $beacon->update($data);

        return ['data' => $beacon->setRelation('user', $user)->present($user)];
    }

    /** DELETE /api/beacons/{beacon}. Owner only. */
    public function destroy(Request $request, Beacon $beacon)
    {
        abort_unless($beacon->user_id === $request->user()->id, 403, 'Only the player who set a beacon can delete it.');
        $beacon->delete();

        return response()->noContent();
    }

    /**
     * POST /api/beacons/import: an export file, as the player's own copies,
     * not shared. other_shard lists the imported beacons on another shard
     * than the one the player's client last reported; it is empty when no
     * shard has been reported, since there is nothing to compare with.
     */
    public function import(Request $request)
    {
        $user = $request->user();
        $data = $request->validate([
            'format' => ['required', 'in:'.self::FORMAT],
            'version' => ['required', 'integer', 'in:'.self::VERSION],
            'beacons' => ['required', 'array', 'list', 'min:1', 'max:500'],
        ] + $this->beaconRules('beacons.*.'));
        $this->guardCount($user, count($data['beacons']));

        $imported = DB::transaction(fn () => collect($data['beacons'])->map(fn (array $row) => Beacon::create(
            $this->attributes($row) + ['user_id' => $user->id, 'shared' => false],
        )));

        $current = $user->current_shard;

        return response()->json([
            'data' => $imported->map(fn (Beacon $b) => $b->setRelation('user', $user)->present($user))->values(),
            'current_shard' => $current,
            'other_shard' => $current === null ? [] : $imported->where('shard', '!=', $current)->pluck('id')->values(),
        ], 201);
    }

    /** GET /api/me/shard: the game shard the player's client last reported. */
    public function showShard(Request $request)
    {
        $user = $request->user();

        return ['shard' => $user->current_shard, 'at' => $user->current_shard_at?->toIso8601String()];
    }

    /** PUT /api/me/shard, from the client: the SolarSystem zone it is on now, or null. */
    public function updateShard(Request $request)
    {
        $data = $request->validate(['shard' => ['present', 'nullable', 'string', 'max:64', 'regex:/^SolarSystem_\d+$/']]);
        $user = $request->user();
        $user->forceFill(['current_shard' => $data['shard'], 'current_shard_at' => now()])->save();

        return $this->showShard($request);
    }

    /** One beacon's fields, under a prefix ('' or 'beacons.*.'). */
    private function beaconRules(string $p): array
    {
        $finite = function (string $attribute, mixed $value, \Closure $fail) {
            if (! (is_int($value) || is_float($value)) || ! is_finite((float) $value)) {
                $fail('Each coordinate must be a finite number.');
            }
        };

        return [
            $p.'name' => ['required', 'string', 'max:80'],
            $p.'shard' => ['required', 'string', 'max:64', 'regex:/^SolarSystem_\d+$/'],
            $p.'frame' => ['required', 'string', 'max:120'],
            $p.'pos' => ['required', 'array', 'list', 'size:3'],
            $p.'pos.*' => ['required', $finite],
            $p.'system' => ['nullable', 'string', 'max:64'],
            $p.'location' => ['nullable', 'string', 'max:255'],
            $p.'server' => ['nullable', 'string', 'max:128'],
            $p.'set_at' => ['nullable', 'date'],
        ];
    }

    private function attributes(array $row): array
    {
        return [
            'name' => $row['name'],
            'shard' => $row['shard'],
            'frame' => $row['frame'],
            'pos_x' => (float) $row['pos'][0],
            'pos_y' => (float) $row['pos'][1],
            'pos_z' => (float) $row['pos'][2],
            'system' => $row['system'] ?? null,
            'location' => $row['location'] ?? null,
            'server' => $row['server'] ?? null,
            'set_at' => isset($row['set_at']) ? Carbon::parse($row['set_at']) : now(),
        ];
    }

    private function guardCount(User $user, int $adding): void
    {
        abort_if(
            Beacon::where('user_id', $user->id)->count() + $adding > self::MAX_PER_USER,
            422,
            'A player can keep at most '.self::MAX_PER_USER.' beacons. Delete some first.',
        );
    }
}
