<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The HUD colour a contributor sampled off the panel itself.
 *
 * Naming a colour from a dropdown is a guess; clicking the panel's brightest
 * HUD element is a measurement. The named colour stays as the training label —
 * it is what the model's classification head is trained against — and the hex
 * is kept alongside it as the objective record, so the buckets can be redrawn
 * later without re-collecting anything.
 *
 * Screens and ships also become free text with autocomplete, so a contributor
 * can name a panel nobody has submitted yet. An index makes the vocabulary
 * lookups behind that autocomplete cheap.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('screenshot_submissions', function (Blueprint $table) {
            $table->string('hud_hex', 7)->nullable()->after('hud_colour');
            $table->index('screen');
            $table->index('ship');
        });
    }

    public function down(): void
    {
        Schema::table('screenshot_submissions', function (Blueprint $table) {
            $table->dropIndex(['screen']);
            $table->dropIndex(['ship']);
            $table->dropColumn('hud_hex');
        });
    }
};
