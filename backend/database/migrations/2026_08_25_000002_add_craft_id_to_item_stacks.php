<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Crafted item stacks keep a link to the craft.completed audit row so the
// craft stays undoable from the Items ledger, not just the modal.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('item_stacks', function (Blueprint $table) {
            $table->foreignId('craft_id')->nullable()->constrained('audit_logs')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('item_stacks', function (Blueprint $table) {
            $table->dropConstrainedForeignId('craft_id');
        });
    }
};
