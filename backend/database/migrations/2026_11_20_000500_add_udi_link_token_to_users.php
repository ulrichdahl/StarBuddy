<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The player's link token for the UDI StarLabels/StarConfig tools, stored
 * encrypted: the player's desktop clients need it back to fetch their files.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->text('udi_link_token')->nullable();
            $table->timestampTz('udi_linked_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['udi_link_token', 'udi_linked_at']);
        });
    }
};
