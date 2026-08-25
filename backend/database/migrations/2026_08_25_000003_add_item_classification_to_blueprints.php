<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Output-item classification from the wiki items API, so the UI can say
// "Armor · Undersuit" or "Radar · Industrial" instead of raw type codes.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('blueprints', function (Blueprint $table) {
            $table->string('item_uuid', 64)->nullable()->index();
            $table->string('type_label')->nullable();
            $table->string('sub_type_label')->nullable();
            $table->string('classification')->nullable();   // e.g. Ship.Radar.MidRangeRadar
            $table->string('component_class', 64)->nullable(); // Industrial / Military / Civilian / Stealth / Competition
        });
    }

    public function down(): void
    {
        Schema::table('blueprints', function (Blueprint $table) {
            $table->dropColumn(['item_uuid', 'type_label', 'sub_type_label', 'classification', 'component_class']);
        });
    }
};
