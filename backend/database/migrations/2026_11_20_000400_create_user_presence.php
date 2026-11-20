<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What a player is doing in the game right now, as their desktop client
 * last reported it: one row per player, shown to the mates of their org.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_presence', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->boolean('running')->default(false);
            $table->string('environment', 16)->nullable();
            $table->string('branch', 64)->nullable();
            $table->string('shard', 128)->nullable();
            $table->string('location_code', 128)->nullable();
            $table->string('location', 128)->nullable();
            $table->string('ship', 128)->nullable();
            $table->string('character_name', 64)->nullable();
            $table->string('geid', 32)->nullable();
            $table->string('account_id', 32)->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_presence');
    }
};
