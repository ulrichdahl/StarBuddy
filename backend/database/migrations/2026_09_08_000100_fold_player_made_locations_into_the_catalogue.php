<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Locations are the shared catalogue now, so the rows players made along the
 * way have to go somewhere. A player's "Levski" and the catalogue's Levski are
 * the same station, and holding both split one refinery into two entries in
 * every picker — so everything filed under the player's row moves to the
 * catalogue's and the duplicate goes.
 *
 * A player row the catalogue has never heard of is left alone: it still holds
 * things, and there is nothing to fold it into.
 */
return new class extends Migration
{
    public function up(): void
    {
        $catalogue = DB::table('locations')
            ->whereNull('user_id')->whereNull('org_id')
            ->get(['id', 'name'])
            ->keyBy(fn ($l) => str_replace(' ', '', mb_strtolower($l->name)));

        $mine = DB::table('locations')
            ->where(fn ($q) => $q->whereNotNull('user_id')->orWhereNotNull('org_id'))
            ->get(['id', 'name']);

        foreach ($mine as $location) {
            $twin = $catalogue->get(str_replace(' ', '', mb_strtolower($location->name)));
            if (! $twin) {
                continue;
            }

            DB::table('item_stacks')->where('location_id', $location->id)->update(['location_id' => $twin->id]);
            DB::table('resource_stacks')->where('location_id', $location->id)->update(['location_id' => $twin->id]);
            DB::table('refinery_orders')->where('location_id', $location->id)->update(['location_id' => $twin->id]);
            DB::table('refinery_orders')->where('collected_location_id', $location->id)
                ->update(['collected_location_id' => $twin->id]);
            DB::table('locations')->where('id', $location->id)->delete();
        }
    }

    public function down(): void
    {
        // The player's row is gone and what it held now sits under the
        // catalogue's, which is where it belonged. Nothing to put back.
    }
};
