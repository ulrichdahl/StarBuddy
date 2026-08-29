<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Game item catalog (every item the Star Citizen Wiki items API lists),
// synced nightly by starbuddy:sync-item-catalog. Backs the item-entry
// autocomplete; item_stacks keep their own item_class/item_name copy so a
// stack survives catalog churn.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('items', function (Blueprint $table) {
            $table->id();
            $table->string('uuid', 64)->unique();
            $table->string('name')->index();
            $table->string('class_name')->nullable()->index();
            $table->string('type')->nullable()->index();
            $table->string('type_label')->nullable();
            $table->string('sub_type')->nullable();
            $table->string('sub_type_label')->nullable();
            $table->string('classification')->nullable();
            $table->string('manufacturer')->nullable();
            $table->unsignedTinyInteger('size')->nullable();
            $table->string('grade', 8)->nullable();
            $table->boolean('is_craftable')->default(false);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('items');
    }
};
