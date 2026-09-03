<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * An order's visibility was never stored. It was read back off the first stack
 * the order produced, which works right up until an order produces none — every
 * row switched off, or no material the catalogue recognised — and then the
 * answer is "private" no matter what was asked for, with nowhere to correct it.
 *
 * It belongs on the order: an order is a thing that can be shared whether or
 * not it has yielded anything yet. The stacks keep their own copy, because that
 * is what the materials lists filter on.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('refinery_orders', function (Blueprint $table) {
            $table->string('visibility', 20)->default('private');
        });

        // Existing orders already answered this through their stacks, so take
        // the answer from there rather than making everyone private again.
        DB::table('refinery_orders')->update([
            'visibility' => DB::raw(
                '(select coalesce(min(visibility), \'private\') from resource_stacks'
                .' where resource_stacks.refinery_order_id = refinery_orders.id)'
            ),
        ]);
    }

    public function down(): void
    {
        Schema::table('refinery_orders', function (Blueprint $table) {
            $table->dropColumn('visibility');
        });
    }
};
