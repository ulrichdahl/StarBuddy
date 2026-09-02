<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Remove the refinery orders that came from the Game.log watcher.
 *
 * Those rows were made from a "refinery order completed" line, which says
 * only that something finished — no materials, no yields, no station. As
 * orders they are empty, and because nothing ever collected them they all
 * show as still in progress, which is the opposite of what they recorded.
 *
 * An order is now read off the terminal, where all of that is on screen, and
 * the log event is accepted and ignored for older clients. So these rows have
 * no future: they cannot be completed, cannot be filled in, and only clutter
 * the list. Any stack that somehow points at one is detached first rather
 * than relying on the foreign key's ON DELETE, which is not enforced on every
 * driver this runs on.
 */
return new class extends Migration
{
    public function up(): void
    {
        $ids = DB::table('refinery_orders')->where('source', 'log')->pluck('id');
        if ($ids->isEmpty()) {
            return;
        }

        DB::table('resource_stacks')->whereIn('refinery_order_id', $ids)->update(['refinery_order_id' => null]);
        DB::table('refinery_orders')->whereIn('id', $ids)->delete();
    }

    public function down(): void
    {
        // Nothing to put back: the rows held no information beyond the fact
        // that some order finished at some time, and that is what the log
        // event itself already said.
    }
};
