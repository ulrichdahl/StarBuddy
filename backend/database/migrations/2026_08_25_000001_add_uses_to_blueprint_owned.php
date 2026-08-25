<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Blueprints are never consumed by crafting — the game tracks how many
// times a blueprint has been used for yourself vs. for the org, so we do
// the same per owned copy.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('blueprint_owned', function (Blueprint $table) {
            $table->unsignedInteger('uses_personal')->default(0);
            $table->unsignedInteger('uses_org')->default(0);
        });
    }

    public function down(): void
    {
        Schema::table('blueprint_owned', function (Blueprint $table) {
            $table->dropColumn(['uses_personal', 'uses_org']);
        });
    }
};
