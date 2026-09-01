<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// The recipe's slots (Frame, Barrel, Cycler, …) with the stat modifiers each
// slot's material applies to the crafted item. Lazily fetched from the wiki
// blueprint endpoint (only the detail route carries them) and cached here.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('blueprints', function (Blueprint $table) {
            $table->json('requirement_groups')->nullable(); // {v, groups: [{key, name, material, modifiers}]}
        });
    }

    public function down(): void
    {
        Schema::table('blueprints', function (Blueprint $table) {
            $table->dropColumn('requirement_groups');
        });
    }
};
