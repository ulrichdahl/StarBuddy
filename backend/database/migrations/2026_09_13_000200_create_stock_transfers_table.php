<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Stock changing hands — materials or items, sold for a price or for nothing.
// The stacks themselves move to the recipient (or simply leave, when the buyer
// is nobody StarBuddy knows), so this is the only record that the handover
// happened: what went, to whom, and what it fetched.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stock_transfers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('org_id')->nullable()->constrained()->nullOnDelete();
            // 'material' or 'item': which ledger of stock this came out of.
            $table->string('stock', 8)->default('material');
            // The recipient as StarBuddy knows them, if it does. A buyer who
            // has no account is a handle and nothing more, which is why the
            // name is kept whether or not the id is.
            $table->foreignId('to_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('to_handle');
            // aUEC. Zero is a real price, and the way a gift is recorded.
            $table->decimal('price', 14, 2)->default(0);
            $table->foreignId('location_id')->nullable()->constrained()->nullOnDelete();
            // What changed hands, as it read at the time: a ledger must not
            // change when a stack is later spent, split or renamed.
            $table->json('lines');
            $table->text('note')->nullable();
            $table->timestamps();
            $table->index(['user_id', 'created_at']);
            $table->index(['to_user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_transfers');
    }
};
