<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Where a blueprint comes from. A recipe is not bought: the game hands it out
// from a weighted pool when a mission is completed, and the pool is named by
// the mission's own contract definition. Both tables are game data, synced from
// database/data/blueprint-pools.json by starbuddy:sync-blueprint-pools.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('blueprint_pools', function (Blueprint $table) {
            $table->id();
            // The pool's record name in the game's DataCore, lowercased:
            // bp_missionreward_rdc_generic.
            $table->string('key')->unique();
            $table->string('record')->nullable();
            // Who hands it out: one entry per contractor, with the mission
            // titles they offer, plus event tiers. Read-only, so the shape the
            // extractor wrote is the shape the API serves.
            $table->json('sources')->nullable();
            $table->timestamps();
        });

        Schema::create('blueprint_pool_entries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('blueprint_pool_id')->constrained()->cascadeOnDelete();
            // Nullable: a pool can name a recipe the wiki has not published
            // yet, and the key is worth keeping until it does.
            $table->foreignId('blueprint_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('blueprint_key');
            // The blueprint's share of the pool. Every weight is 1.0 today, so
            // the odds are one in however many the pool holds — but the game
            // has the field, so we keep it rather than counting rows.
            $table->decimal('weight', 8, 3)->default(1);
            $table->timestamps();
            $table->unique(['blueprint_pool_id', 'blueprint_key']);
            $table->index('blueprint_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('blueprint_pool_entries');
        Schema::dropIfExists('blueprint_pools');
    }
};
