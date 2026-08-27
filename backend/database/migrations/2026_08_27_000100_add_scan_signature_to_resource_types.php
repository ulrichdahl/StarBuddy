<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Radar signature of the rock a mineral dominates (Alpha 4.7+ scanner
// model: fixed base value per mineral, summed over a cluster), with the
// mining stats and composition profile from database/data/scan-signatures.json.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('resource_types', function (Blueprint $table) {
            $table->unsignedInteger('scan_signature')->nullable()->index();
            $table->float('mining_instability')->nullable();
            $table->float('mining_resistance')->nullable();
            $table->json('scan_profile')->nullable(); // {dominant:[min,max], companions:[{name,share:[min,max]}]}
        });
    }

    public function down(): void
    {
        Schema::table('resource_types', function (Blueprint $table) {
            $table->dropColumn(['scan_signature', 'mining_instability', 'mining_resistance', 'scan_profile']);
        });
    }
};
