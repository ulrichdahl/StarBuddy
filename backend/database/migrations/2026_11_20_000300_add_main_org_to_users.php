<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A player's main org, as in Star Citizen: the one their points go to and
 * the dashboard shows. Always set while they are in any org.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->foreignId('main_org_id')->nullable()->after('locale')->constrained('orgs')->nullOnDelete();
        });

        // Until now the first org joined (lowest id) was used everywhere.
        $firsts = DB::table('org_members')
            ->where('status', 'active')
            ->groupBy('user_id')
            ->selectRaw('user_id, min(org_id) as org_id')
            ->get();
        foreach ($firsts as $row) {
            DB::table('users')->where('id', $row->user_id)->update(['main_org_id' => $row->org_id]);
        }
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropConstrainedForeignId('main_org_id');
        });
    }
};
