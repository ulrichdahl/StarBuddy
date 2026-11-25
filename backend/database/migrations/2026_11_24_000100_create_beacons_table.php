<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Location beacons from the desktop client: a point a player marked in one
 * of the game's coordinate frames, to steer back to later. A beacon only
 * means something on the game shard it was set on (shard is the exact
 * SolarSystem_<n> zone name), and a planet beacon turns with its planet.
 *
 * The user also gets the shard their client last reported, so the website
 * can say which beacons are on another shard than the one they play on.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('beacons', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name', 80);
            $table->string('shard', 64);
            $table->string('frame', 120);
            $table->double('pos_x');
            $table->double('pos_y');
            $table->double('pos_z');
            $table->string('system', 64)->nullable();
            $table->string('location', 255)->nullable();
            $table->string('server', 128)->nullable();
            $table->timestamp('set_at');
            // Shared with the members of the owner's orgs.
            $table->boolean('shared')->default(false);
            $table->timestamps();

            $table->index(['user_id', 'shared']);
        });

        Schema::table('users', function (Blueprint $table) {
            $table->string('current_shard', 64)->nullable();
            $table->timestamp('current_shard_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['current_shard', 'current_shard_at']);
        });
        Schema::dropIfExists('beacons');
    }
};
