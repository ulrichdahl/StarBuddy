<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Mirror of the incidents published on status.robertsspaceindustries.com,
// kept so the poller can tell "new", "updated" and "resolved" apart and
// so the web app, client and bot can show the current picture without
// hitting RSI themselves.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rsi_incidents', function (Blueprint $table) {
            $table->id();
            $table->string('slug')->unique();          // cstate filename minus .md
            $table->string('title');
            $table->string('severity', 32);            // maintenance|notice|disrupted|down|…
            $table->boolean('resolved')->default(false);
            $table->boolean('informational')->default(false);
            $table->json('affected')->nullable();      // ["Persistent Universe", …]
            $table->text('body_html')->nullable();
            $table->string('permalink')->nullable();
            $table->timestamp('started_at')->nullable();   // cstate createdAt
            $table->timestamp('rsi_updated_at')->nullable(); // cstate lastMod
            $table->timestamp('resolved_at')->nullable();
            $table->string('body_hash', 64)->nullable(); // what we last alerted on
            $table->timestamps();
            $table->index(['resolved', 'started_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rsi_incidents');
    }
};
