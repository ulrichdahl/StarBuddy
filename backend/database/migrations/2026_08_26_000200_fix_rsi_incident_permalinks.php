<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// Permalinks were stored without index.html, which the static status site
// cannot serve. Restore RSI's exact form on rows the poller already has.
return new class extends Migration
{
    public function up(): void
    {
        DB::table('rsi_incidents')
            ->where('permalink', 'like', '%/')
            ->update(['permalink' => DB::raw("permalink || 'index.html'")]);
    }

    public function down(): void
    {
        // Nothing to undo: the corrected form is what RSI publishes.
    }
};
