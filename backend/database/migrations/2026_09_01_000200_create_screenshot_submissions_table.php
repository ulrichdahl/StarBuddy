<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Screenshots contributed for training the panel detector.
 *
 * A member uploads one capture with the panel's four corners marked; an org
 * manager approves or rejects it; approved rows are exported as a dataset the
 * model is trained on locally. The image itself lives on the private disk —
 * only this row knows where.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('screenshot_submissions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // Which org reviews it. Null for a member who belongs to none, so
            // the submission waits for any manager rather than being lost.
            $table->foreignId('org_id')->nullable()->constrained()->nullOnDelete();

            $table->string('status')->default('pending'); // pending | approved | rejected
            $table->string('image_path');
            // sha256 of the file: the same capture cannot be submitted twice,
            // by the same person or by two people sharing screenshots.
            $table->string('image_hash', 64)->unique();
            $table->string('mime', 40);
            $table->unsignedInteger('width');
            $table->unsignedInteger('height');
            $table->unsignedInteger('bytes');

            $table->string('patch');
            $table->string('ship')->nullable(); // null = on foot
            $table->string('screen');
            $table->string('hud_colour')->default('unknown');
            $table->boolean('occluded')->default(false);
            // Four [x, y] pairs normalised 0..1, ordered TL, TR, BR, BL.
            $table->json('quad');

            $table->text('submitter_note')->nullable();
            $table->text('review_note')->nullable();
            $table->foreignId('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            // When this row last left the site inside a dataset export, so a
            // manager can tell what the current model was actually trained on.
            $table->timestamp('exported_at')->nullable();

            $table->timestamps();

            $table->index(['status', 'created_at']);
            $table->index(['org_id', 'status']);
            $table->index(['user_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('screenshot_submissions');
    }
};
