<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Fill in the star system on locations created from a refinery order.
 *
 * A refinery order names its station, and a station StarBuddy had no location
 * for was created from that name alone — with no system, because the terminal
 * does not print one. A location without a system is shown as one of the
 * player's own, so Levski turned up under "Personal" instead of Nyx.
 *
 * The catalogue already knows most of these places under another kind, so the
 * system is copied from the row that has one.
 */
return new class extends Migration
{
    public function up(): void
    {
        $known = DB::table('locations')
            ->whereNotNull('system')
            ->get(['name', 'system'])
            ->keyBy(fn ($row) => mb_strtolower($row->name));

        foreach (DB::table('locations')->whereNull('system')->get(['id', 'name']) as $location) {
            $match = $known->get(mb_strtolower($location->name));
            if ($match) {
                DB::table('locations')->where('id', $location->id)->update(['system' => $match->system]);
            }
        }
    }

    public function down(): void
    {
        // Nothing to undo: the system was missing, not different, and which
        // rows had been filled in is not recorded anywhere.
    }
};
