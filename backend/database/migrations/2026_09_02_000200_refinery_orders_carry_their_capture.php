<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Refinery orders become a tracked job rather than a note that one finished.
 *
 * The desktop client now reads a work order straight off the terminal, so an
 * order carries what was on screen: which panel it was, what it is refining,
 * what it cost, and when it will be done. The refinery itself is a location, so
 * the yields can sit there until they are collected and then move to wherever
 * the player puts them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('refinery_orders', function (Blueprint $table) {
            // The refinery, as a place materials can be at.
            $table->foreignId('location_id')->nullable()->after('station')->constrained('locations')->nullOnDelete();
            // The panel's own number, so two orders at one station stay apart.
            $table->unsignedInteger('work_order_number')->nullable()->after('method');
            // setup | processing | completed — what the terminal was showing.
            $table->string('state')->nullable()->after('work_order_number');
            // The unit every amount is counted in; the terminal works in cSCU.
            $table->string('unit')->default('cSCU')->after('materials');
            $table->unsignedBigInteger('duration_seconds')->nullable()->after('unit');
            $table->decimal('cost', 14, 2)->nullable()->after('duration_seconds');
            $table->decimal('yield_total', 14, 2)->nullable()->after('cost');
            // Everything else the capture saw, kept whole so the order can be
            // shown exactly as it was read without inventing columns for each
            // field the panel might grow.
            $table->json('capture')->nullable()->after('yield_total');

            // Collection: when, and where the materials went.
            $table->timestamp('collected_at')->nullable()->after('completed_at');
            $table->foreignId('collected_location_id')->nullable()->after('collected_at')
                ->constrained('locations')->nullOnDelete();

            $table->index(['user_id', 'collected_at']);
        });

        Schema::table('resource_stacks', function (Blueprint $table) {
            // A stack the refinery is still working on. It shows in the
            // materials and craft lists marked as refining, and moves to its
            // real location when the order is collected.
            $table->foreignId('refinery_order_id')->nullable()->after('source')
                ->constrained('refinery_orders')->nullOnDelete();
            $table->index('refinery_order_id');
        });
    }

    public function down(): void
    {
        Schema::table('resource_stacks', function (Blueprint $table) {
            $table->dropConstrainedForeignKey('refinery_order_id');
        });
        Schema::table('refinery_orders', function (Blueprint $table) {
            $table->dropConstrainedForeignKey('location_id');
            $table->dropConstrainedForeignKey('collected_location_id');
            $table->dropIndex(['user_id', 'collected_at']);
            $table->dropColumn([
                'work_order_number', 'state', 'unit', 'duration_seconds',
                'cost', 'yield_total', 'capture', 'collected_at',
            ]);
        });
    }
};
