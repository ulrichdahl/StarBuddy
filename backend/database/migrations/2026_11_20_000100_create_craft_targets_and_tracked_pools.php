<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// What a player is working towards. A craft target is a blueprint they mean
// to make, and how many; its materials become the desktop client's
// gathering list. A tracked pool is a mission reward pool they are farming,
// followed until they hold every blueprint in it.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('craft_targets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('blueprint_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('quantity')->default(1);
            $table->timestamps();
            $table->unique(['user_id', 'blueprint_id']);
        });

        Schema::create('tracked_pools', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('blueprint_pool_id')->constrained()->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['user_id', 'blueprint_pool_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tracked_pools');
        Schema::dropIfExists('craft_targets');
    }
};
