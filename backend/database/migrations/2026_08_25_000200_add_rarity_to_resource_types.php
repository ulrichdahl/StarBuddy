<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Rarity derived from spawn probabilities in the wiki's mining location
// data; spawn_score keeps the raw prevalence for reranking.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('resource_types', function (Blueprint $table) {
            $table->string('rarity')->nullable(); // common|uncommon|rare|epic|legendary
            $table->float('spawn_score')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('resource_types', function (Blueprint $table) {
            $table->dropColumn(['rarity', 'spawn_score']);
        });
    }
};
