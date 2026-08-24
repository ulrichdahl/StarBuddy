<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('orgs', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();
            $table->string('sid')->nullable(); // RSI spectrum id / tag
            $table->string('discord_role_id')->nullable();
            $table->timestamps();
        });

        Schema::create('org_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('org_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('role')->default('member'); // member | officer | admin
            $table->timestamps();
            $table->unique(['org_id', 'user_id']);
        });

        Schema::create('locations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('org_id')->nullable()->constrained()->nullOnDelete();
            $table->string('kind')->default('hangar'); // hangar | freight_elevator | ship | base | other
            $table->string('station')->nullable();
            $table->string('name');
            $table->timestamps();
        });

        Schema::create('resource_types', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();
            $table->string('category'); // ore | refined | salvage | gem | gas | other
            $table->string('unit')->default('mscu'); // mscu (0.001 SCU crates) | pieces
            // Quality values seen for this resource — per-resource bands, learned
            // from entries/OCR/imports; offered as quick-pick chips in the UI.
            $table->json('known_qualities')->nullable();
            $table->timestamps();
        });

        Schema::create('resource_stacks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('org_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('location_id')->constrained()->cascadeOnDelete();
            $table->foreignId('resource_type_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('quality'); // exact number off the crate, 0–1000
            $table->unsignedBigInteger('quantity');  // mSCU or pieces, per resource_type.unit
            $table->string('visibility')->default('private'); // private | org
            $table->string('source')->default('manual'); // manual | ocr | log | import
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['org_id', 'resource_type_id', 'quality']);
        });

        Schema::create('item_stacks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('org_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('location_id')->constrained()->cascadeOnDelete();
            $table->string('item_class'); // any game item; no quality (crafted-item buffs later)
            $table->string('item_name')->nullable();
            $table->unsignedBigInteger('quantity');
            $table->string('visibility')->default('private');
            $table->string('source')->default('manual');
            $table->timestamps();
            $table->index(['org_id', 'item_class']);
        });

        Schema::create('blueprints', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();
            $table->string('item_class')->nullable();
            $table->unsignedTinyInteger('tier')->nullable();
            $table->json('tags')->nullable();
            $table->string('game_version')->nullable();
            $table->timestamps();
        });

        Schema::create('blueprint_owned', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('blueprint_id')->nullable()->constrained()->nullOnDelete();
            // Raw name as it appeared in the log/UI; kept even when unresolved
            // against the blueprint database.
            $table->string('blueprint_name');
            $table->timestamp('acquired_at')->nullable();
            $table->string('source')->default('manual'); // log | manual | import
            $table->timestamps();
            $table->unique(['user_id', 'blueprint_name']);
        });

        Schema::create('refinery_orders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('station');
            $table->string('method')->nullable();
            $table->json('materials')->nullable(); // entered/OCR: [{resource, quality, qty_in, qty_out}]
            $table->timestamp('placed_at')->nullable();
            $table->timestamp('eta')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->string('source')->default('manual'); // manual | ocr | log
            $table->timestamps();
        });

        Schema::create('audit_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('org_id')->nullable()->constrained()->nullOnDelete();
            $table->string('action');
            $table->json('details')->nullable();
            $table->timestamps();
        });

        // Idempotent ingestion of Game.log events (desktop client uploads).
        Schema::create('ingest_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('event_type'); // blueprint_received | refinery_completed | shop_buy | shop_sell
            $table->json('payload');
            $table->timestampTz('log_timestamp');
            // sha1(user, type, payload, log timestamp) — re-imports are no-ops.
            $table->string('fingerprint', 64);
            $table->timestamps();
            $table->unique(['user_id', 'fingerprint']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ingest_events');
        Schema::dropIfExists('audit_logs');
        Schema::dropIfExists('refinery_orders');
        Schema::dropIfExists('blueprint_owned');
        Schema::dropIfExists('blueprints');
        Schema::dropIfExists('item_stacks');
        Schema::dropIfExists('resource_stacks');
        Schema::dropIfExists('resource_types');
        Schema::dropIfExists('locations');
        Schema::dropIfExists('org_members');
        Schema::dropIfExists('orgs');
    }
};
