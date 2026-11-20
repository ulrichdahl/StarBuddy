<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One row per point awarded for Game.log activity, keeping the raw log line
 * so the points can be recounted when the rules change (score:recount).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('score_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // The org the player was in when it happened; points stay there
            // when they move on.
            $table->foreignId('org_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('ingest_event_id')->nullable()->constrained('ingest_events')->cascadeOnDelete();
            $table->string('kind'); // mission | refinery | travel
            $table->string('source'); // the ingest kind it came from
            $table->string('detail');
            // Place-like events count once per player per month; this is the place.
            $table->string('place')->nullable();
            $table->string('system')->nullable();
            $table->integer('points');
            $table->unsignedInteger('rules_version');
            $table->text('raw')->nullable();
            $table->string('character_name')->nullable();
            $table->timestampTz('occurred_at');
            $table->timestamps();
            $table->unique('ingest_event_id');
            $table->index(['org_id', 'occurred_at']);
            $table->index(['user_id', 'occurred_at']);
        });

        // Star Citizen accounts known to be the player's: one whose character
        // carried the player's handle. Other characters on the same account
        // (renamed, or before a wipe) count too; other accounts do not.
        Schema::create('user_game_accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('account_id', 32);
            $table->timestamps();
            $table->unique(['user_id', 'account_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_game_accounts');
        Schema::dropIfExists('score_events');
    }
};
