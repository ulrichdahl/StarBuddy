<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// A contract the game marks notForRelease is written but not on the board, and
// a pool whose every mission is marked that way cannot be earned at all — the
// Monde Daimyo armour is in one. Worth saying rather than sending a player
// looking for a mission that is not there.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('blueprint_pools', function (Blueprint $table) {
            $table->boolean('awardable')->default(true);
        });
    }

    public function down(): void
    {
        Schema::table('blueprint_pools', function (Blueprint $table) {
            $table->dropColumn('awardable');
        });
    }
};
