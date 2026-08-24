<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Recipe data synced from the Star Citizen Wiki API (/api/v2/blueprints).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('blueprints', function (Blueprint $table) {
            $table->uuid('uuid')->nullable()->unique();
            $table->string('key')->nullable();          // e.g. BP_CRAFT_AMRS_LaserCannon_S1
            $table->string('type')->nullable();          // WeaponGun, PowerPlant, …
            $table->string('sub_type')->nullable();
            $table->string('grade')->nullable();
            $table->boolean('is_default')->default(false);
            $table->unsignedInteger('craft_time_seconds')->nullable();
            $table->json('ingredients')->nullable();     // [{name, kind, quantity_mscu|quantity_pieces}]
            $table->json('dismantle_returns')->nullable();
            $table->index('item_class');
        });
    }

    public function down(): void
    {
        Schema::table('blueprints', function (Blueprint $table) {
            $table->dropIndex(['item_class']);
            $table->dropColumn([
                'uuid', 'key', 'type', 'sub_type', 'grade', 'is_default',
                'craft_time_seconds', 'ingredients', 'dismantle_returns',
            ]);
        });
    }
};
