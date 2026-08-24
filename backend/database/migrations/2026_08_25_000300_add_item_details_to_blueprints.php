<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Item lore/imagery for the craft detail view, lazily fetched from the
// wiki item endpoint and cached here.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('blueprints', function (Blueprint $table) {
            $table->text('description')->nullable();
            $table->string('image_url', 500)->nullable();
            $table->string('manufacturer')->nullable();
            $table->json('item_meta')->nullable(); // mass, size, item grade, …
        });
    }

    public function down(): void
    {
        Schema::table('blueprints', function (Blueprint $table) {
            $table->dropColumn(['description', 'image_url', 'manufacturer', 'item_meta']);
        });
    }
};
