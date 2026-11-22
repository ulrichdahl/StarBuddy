<?php
// Demo data for the intro video. Everything it makes is tagged so unseed.php
// can remove it: users have discord_id 'demo-*', orgs by name (unseed.sql lists them).
require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\DB;
use Carbon\CarbonImmutable as C;

mt_srand(42);
$now = C::now();
$pick = fn (array $a) => $a[array_rand($a)];

$orgs = [
    ['Nova Vanguard', 'NOVA', ['Kestrel', 'Vyx', 'Orrin_Hale', 'Mara_Quill', 'Dax_Tarn', 'Lyra_Voss', 'Juno_Pike', 'Rook_Sable', 'Tess_Arden', 'Nyx_Corvo'], 1.0],
    ['Iron Meridian', 'IRON', ['Brannoc', 'Sella_Reyne', 'Hollis_Crane', 'Varek', 'Ines_Morrow', 'Teague'], 0.95],
    ['Blackwater Salvage', 'BWS', ['Grit', 'Pell_Ashby', 'Corwin_Slate', 'Maeve_Torr', 'Quill'], 0.8],
    ['Outer Rim Haulers', 'RIM', ['Fenwick', 'Odessa_Vale', 'Lars_Brack', 'Sunny_Kade'], 0.7],
    ['Halcyon Survey Corps', 'HSC', ['Aster', 'Wren_Calloway', 'Silas_Oake', 'Mira_Lenz', 'Ozzy_Fen'], 0.6],
];

$missions = ['Alliance Aid: Hauler Hunters', 'Alliance Aid: Collect Manufacturing Resource - Small Scale', 'Bounty: Neutralize Wanted Pirate', 'Cargo Haul: Lorville to Area18', 'Salvage Contract: Derelict Recovery', 'Mercenary: Defend Outpost', 'Delivery: Medical Supplies to Port Tressler', 'Investigation: Missing Hauler', 'Mining Contract: Quantainium Run'];
$places = [['Levski', 'nyx'], ['Area18', 'stanton'], ['Lorville', 'stanton'], ['New Babbage', 'stanton'], ['Orison', 'stanton'], ['Port Tressler', 'stanton'], ['Baijini Point', 'stanton'], ['Everus Harbor', 'stanton'], ['Ruin Station', 'pyro'], ['Checkmate', 'pyro']];
$ships = ['Drake Cutlass Black', 'MISC Prospector', 'Argo MOLE', 'Anvil Carrack', 'Crusader C2 Hercules', 'RSI Constellation Andromeda', 'Aegis Gladius', 'Drake Vulture', 'MISC Freelancer MAX', 'Origin 400i'];
$shard = 'pub_euw1b_demo_0042';

$userIds = [];
foreach ($orgs as $oi => [$orgName, $sid, $handles, $weight]) {
    $orgId = DB::table('orgs')->insertGetId(['name' => $orgName, 'sid' => $sid, 'created_at' => $now->subMonths(3), 'updated_at' => $now]);
    foreach ($handles as $hi => $h) {
        $uid = DB::table('users')->insertGetId([
            'name' => $h, 'discord_id' => "demo-$sid-$hi", 'discord_username' => strtolower($h), 'handle' => $h,
            'main_org_id' => $orgId, 'locale' => 'en', 'created_at' => $now->subMonths(3), 'updated_at' => $now,
        ]);
        $userIds[$h] = $uid;
        DB::table('org_members')->insert(['org_id' => $orgId, 'user_id' => $uid, 'role' => $hi === 0 ? 'manager' : 'member', 'status' => 'active', 'created_at' => $now->subMonths(3), 'updated_at' => $now]);

        // Score events: this month and last month, more for busy pilots.
        $activity = $weight * (0.4 + mt_rand(0, 100) / 100);
        foreach ([[$now->startOfMonth(), $now], [$now->startOfMonth()->subMonth(), $now->startOfMonth()]] as $pi => [$from, $to]) {
            $span = max(1, $to->getTimestamp() - $from->getTimestamp());
            $n = (int) round(($pi === 0 ? 60 : 70) * $activity * ($pi === 0 && $oi === 1 ? 0.9 : 1));
            $rows = [];
            for ($i = 0; $i < $n; $i++) {
                $at = $from->addSeconds(mt_rand(0, $span - 1));
                $r = mt_rand(1, 100);
                [$place, $sys] = $pick($places);
                if ($r <= 30) {
                    $rows[] = ['kind' => 'mission', 'source' => 'mission_completed', 'detail' => $pick($missions), 'place' => null, 'system' => null, 'points' => 10];
                } elseif ($r <= 45) {
                    $rows[] = ['kind' => 'refinery', 'source' => 'refinery_completed', 'detail' => $pick(['Levski', 'ARC-L1 Wide Forest Station', 'CRU-L1 Ambitious Dream Station', 'MIC-L1 Shallow Frontier Station', 'HUR-L2 Faithful Dream Station']), 'place' => null, 'system' => null, 'points' => 5];
                } else {
                    $src = $pick(['location', 'quantum_arrived', 'jurisdiction']);
                    $rows[] = ['kind' => 'travel', 'source' => $src, 'detail' => $place, 'place' => 'place:' . strtolower(str_replace(' ', '_', $place)), 'system' => $sys, 'points' => $src === 'jurisdiction' ? 2 : $pick([3, 3, 3, 5, 8])];
                }
                $rows[count($rows) - 1] += ['user_id' => $uid, 'org_id' => $orgId, 'rules_version' => 1, 'character_name' => $h, 'occurred_at' => $at, 'raw' => null, 'created_at' => $now, 'updated_at' => $now];
            }
            foreach (array_chunk($rows, 200) as $chunk) DB::table('score_events')->insert($chunk);
        }

        // Presence: about two thirds are in the game, Nova mostly on our shard.
        $running = mt_rand(1, 100) <= 65 || ($oi === 0 && $hi < 6);
        [$place] = $pick($places);
        DB::table('user_presence')->insert([
            'user_id' => $uid, 'running' => $running, 'environment' => 'PUB', 'branch' => 'sc-alpha-4.10.0',
            'shard' => $running ? (($oi === 0 && $hi < 5) || mt_rand(1, 4) === 1 ? $shard : 'pub_euw1b_demo_' . mt_rand(1000, 9999)) : null,
            'location' => $place, 'location_code' => null, 'ship' => $pick($ships), 'character_name' => $h,
            'created_at' => $now, 'updated_at' => $running ? $now->subSeconds(mt_rand(10, 90)) : $now->subHours(mt_rand(2, 70)),
        ]);
    }
}

$me = $userIds['Kestrel'];
// Kestrel is "you": where preview-stub.js says the player is.
DB::table('user_presence')->where('user_id', $me)->update(['running' => true, 'shard' => $shard, 'location' => 'Port Tressler', 'ship' => 'Drake Cutlass Black']);
$novaId = DB::table('orgs')->where('sid', 'NOVA')->where('name', 'Nova Vanguard')->value('id');
$nova = array_slice(array_values($userIds), 0, 10);

// Stock: refined materials and gems at stations, shared with the org.
$stations = DB::table('locations')->whereNull('user_id')->pluck('id', 'name');
$res = DB::table('resource_types')->whereIn('category', ['refined', 'gem'])->pluck('id', 'name')->all();
$favour = ['Quantainium', 'Laranite', 'Agricium', 'Bexalite', 'Gold', 'Taranite', 'Titanium', 'Copper', 'Iron', 'Tungsten', 'Corundum', 'Beryl', 'Hadanite', 'Aphorite', 'Dolivine'];
foreach ($nova as $k => $uid) {
    $n = $uid === $me ? 18 : mt_rand(5, 12);
    for ($i = 0; $i < $n; $i++) {
        $name = $pick(array_values(array_filter($favour, fn ($f) => isset($res[$f]))));
        DB::table('resource_stacks')->insert([
            'user_id' => $uid, 'org_id' => $novaId, 'location_id' => $stations[$pick(['Levski', 'ARC-L1 Wide Forest Station', 'Area18', 'Lorville', 'CRU-L1 Ambitious Dream Station', 'Port Tressler'])],
            'resource_type_id' => $res[$name], 'quality' => $pick([312, 455, 520, 610, 688, 742, 801, 856, 912, 960]),
            'quantity' => mt_rand(4, 240) * 100, 'visibility' => mt_rand(1, 5) === 1 ? 'private' : 'org', 'source' => 'manual',
            'created_at' => $now->subDays(mt_rand(0, 20)), 'updated_at' => $now->subDays(mt_rand(0, 5)),
        ]);
    }
}

// Items: copy a spread of real item classes from the catalogue.
$items = DB::table('items')->whereNotNull('name')->inRandomOrder()->limit(80)->get(['class_name as class', 'name']);
foreach ($nova as $uid) {
    foreach ($items->random($uid === $me ? 26 : 8) as $it) {
        DB::table('item_stacks')->insert([
            'user_id' => $uid, 'org_id' => $novaId, 'location_id' => $stations[$pick(['Levski', 'Area18', 'Lorville', 'New Babbage', 'Port Tressler'])],
            'item_class' => $it->class, 'item_name' => $it->name, 'quantity' => $pick([1, 1, 1, 2, 3, 4, 6, 10, 24]),
            'quality' => mt_rand(1, 3) === 1 ? null : $pick([500, 640, 720, 810, 900]), 'visibility' => mt_rand(1, 4) === 1 ? 'private' : 'org',
            'source' => 'manual', 'created_at' => $now->subDays(mt_rand(1, 30)), 'updated_at' => $now,
        ]);
    }
}

// Blueprints owned, craft targets, tracked pools.
$bps = DB::table('blueprints')->inRandomOrder()->limit(400)->get(['id', 'name']);
foreach ($nova as $uid) {
    foreach ($bps->random($uid === $me ? 140 : mt_rand(30, 90)) as $bp) {
        // insertOrIgnore: a held blueprint is unique by name, and some names
        // belong to more than one blueprint.
        DB::table('blueprint_owned')->insertOrIgnore(['user_id' => $uid, 'blueprint_id' => $bp->id, 'blueprint_name' => $bp->name, 'acquired_at' => $now->subDays(mt_rand(1, 60)), 'source' => 'log', 'created_at' => $now, 'updated_at' => $now]);
    }
}
foreach (DB::table('blueprint_owned')->where('user_id', $me)->inRandomOrder()->limit(4)->pluck('blueprint_id') as $bid) {
    DB::table('craft_targets')->insert(['user_id' => $me, 'blueprint_id' => $bid, 'quantity' => mt_rand(1, 3), 'created_at' => $now, 'updated_at' => $now]);
}
// Tracked pools with readable names, about 60% of each already owned.
$pools = DB::table('blueprint_pools')->whereIn('key', ['bp_missionreward_shubin_resourcegathering_fpsmining_pyro', 'bp_missionreward_foxwellenforcement_patrol', 'bp_missionreward_headhunters_mercenaryfps_eliminateall_regioncd'])->pluck('id');
foreach ($pools as $pid) {
    DB::table('tracked_pools')->insert(['user_id' => $me, 'blueprint_pool_id' => $pid, 'created_at' => $now, 'updated_at' => $now]);
    $have = DB::table('blueprint_owned')->where('user_id', $me)->pluck('blueprint_id')->all();
    foreach (DB::table('blueprint_pool_entries')->join('blueprints', 'blueprints.id', '=', 'blueprint_pool_entries.blueprint_id')
        ->where('blueprint_pool_id', $pid)->whereNotIn('blueprints.id', $have)->get(['blueprints.id', 'blueprints.name']) as $bp) {
        if (mt_rand(1, 10) <= 6) {
            DB::table('blueprint_owned')->insertOrIgnore(['user_id' => $me, 'blueprint_id' => $bp->id, 'blueprint_name' => $bp->name, 'acquired_at' => $now->subDays(5), 'source' => 'log', 'created_at' => $now, 'updated_at' => $now]);
        }
    }
}

// Refinery orders: a few running, one ready, two collected.
$ores = ['Quantainium (Ore)', 'Laranite (Ore)', 'Agricium (Ore)', 'Bexalite (Ore)', 'Gold (Ore)', 'Taranite (Ore)', 'Copper (Ore)', 'Titanium (Ore)'];  // catalogue names
$methods = ['Dinyx Solventation', 'Pyrometric Chromalysis', 'Ferron Exchange', 'Cormack Method', 'Thermonatic Deposition'];
$plan = [[-1, 4 * 3600, 'processing'], [-3, 7 * 3600, 'processing'], [-2, 11 * 3600, 'processing'], [-9, 5 * 3600, 'processing'], [-30, 2 * 3600, 'completed'], [-50, 3 * 3600, 'completed']];
foreach ($nova as $k => $uid) {
    $orders = $uid === $me ? $plan : array_slice($plan, 0, mt_rand(0, 3));
    foreach ($orders as $j => [$hoursAgo, $dur, $state]) {
        $placed = $now->addHours($hoursAgo)->subMinutes(mt_rand(0, 50));
        $mats = [];
        foreach ((array) array_rand(array_flip($ores), mt_rand(2, 4)) as $ore) {
            $qty = mt_rand(80, 900);
            $mats[] = ['resource' => $ore, 'quality' => mt_rand(400, 960), 'yield_amount' => (int) round($qty * 0.42), 'qty' => $qty, 'refine' => true];
        }
        $done = $placed->addSeconds($dur) < $now;
        $station = $pick(['Levski', 'ARC-L1 Wide Forest Station', 'CRU-L1 Ambitious Dream Station', 'MIC-L1 Shallow Frontier Station']);
        $placeId = $stations[$station] ?? null;
        $orderId = DB::table('refinery_orders')->insertGetId([
            'user_id' => $uid, 'station' => $station, 'location_id' => $placeId,
            'collected_location_id' => $state === 'completed' ? $placeId : null,
            'method' => $pick($methods), 'materials' => json_encode($mats), 'placed_at' => $placed, 'eta' => $placed->addSeconds($dur),
            'completed_at' => $state === 'completed' ? $placed->addSeconds($dur) : null, 'collected_at' => $state === 'completed' ? $placed->addSeconds($dur + 3600) : null,
            'source' => 'ocr', 'work_order_number' => 10 + $j, 'state' => $state, 'unit' => 'cSCU', 'duration_seconds' => $dur,
            'cost' => mt_rand(800, 9000), 'yield_total' => array_sum(array_column($mats, 'yield_amount')), 'visibility' => 'org',
            'created_at' => $placed, 'updated_at' => $now,
        ]);
        // The stacks the order is producing, as the website's store() makes
        // them: one per refined line, tied to the order. Without them the
        // order dialog says "No catalogue entry" for every line.
        foreach ($mats as $m) {
            $type = App\Support\RefineryYield::resolveType($m['resource']);
            $qty = $type && $placeId ? App\Support\RefineryYield::toStackQuantity((float) $m['yield_amount'], 'cSCU', $type) : null;
            if ($qty === null) {
                continue;
            }
            DB::table('resource_stacks')->insert([
                'user_id' => $uid, 'org_id' => $novaId, 'location_id' => $placeId, 'resource_type_id' => $type->id,
                'quality' => $m['quality'], 'quantity' => $qty, 'visibility' => 'org', 'source' => 'ocr',
                'refinery_order_id' => $orderId, 'created_at' => $placed, 'updated_at' => $now,
            ]);
        }
    }
}

// A web session for Kestrel, printed as a ready cookie.
$session = app('session')->driver();
$session->start();
$session->put('login_web_' . sha1(Illuminate\Auth\SessionGuard::class), $me);
$session->put('_token', Illuminate\Support\Str::random(40));
$session->save();
DB::table('sessions')->where('id', $session->getId())->update(['user_id' => $me]);
$name = config('session.cookie');
$value = app('encrypter')->encrypt(Illuminate\Cookie\CookieValuePrefix::create($name, app('encrypter')->getKey()) . $session->getId(), false);
// A device token for the client stub, so it reads the same data.
$token = App\Models\User::find($me)->createToken('demo-video')->plainTextToken;
echo json_encode(['me' => $me, 'cookie' => $name, 'value' => $value, 'token' => $token]), "\n";
