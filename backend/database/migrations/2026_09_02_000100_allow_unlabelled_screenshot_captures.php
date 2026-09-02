<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Let a screenshot arrive before anyone has labelled it.
 *
 * The desktop client can now grab the game window on a hotkey and send it
 * straight up. That capture is a submission with its labels still missing: it
 * waits in the contributor's own queue until they mark the corners and name the
 * screen, which fills the columns in and moves it to `pending` for review.
 *
 * Keeping it in one table means one image store, one content hash to dedupe
 * against, and one review path — a separate captures table would duplicate all
 * three and then have to hand rows across.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('screenshot_submissions', function (Blueprint $table) {
            // Unknown until the contributor labels the capture.
            $table->string('screen')->nullable()->change();
            $table->string('hud_colour')->nullable()->change();
            $table->json('quad')->nullable()->change();
            // Where the image came from: uploaded by hand, or captured by the
            // desktop client on a hotkey.
            $table->string('origin')->default('upload')->after('status');
        });
    }

    public function down(): void
    {
        Schema::table('screenshot_submissions', function (Blueprint $table) {
            $table->dropColumn('origin');
            $table->string('screen')->nullable(false)->change();
            $table->string('hud_colour')->default('unknown')->nullable(false)->change();
            $table->json('quad')->nullable(false)->change();
        });
    }
};
