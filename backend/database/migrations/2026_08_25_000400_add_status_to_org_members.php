<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Joining an org is a request the org's managers accept; role gains the
// 'manager' tier (assigned by Discord server admins through the bot).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('org_members', function (Blueprint $table) {
            $table->string('status')->default('active'); // pending | active
        });
    }

    public function down(): void
    {
        Schema::table('org_members', function (Blueprint $table) {
            $table->dropColumn('status');
        });
    }
};
