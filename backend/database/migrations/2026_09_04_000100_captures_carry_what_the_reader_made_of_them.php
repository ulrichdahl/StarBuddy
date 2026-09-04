<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What the desktop client's reader made of a capture, kept beside the capture.
 *
 * A capture that reads badly is two different faults wearing the same face: a
 * frame OCR could not make out, or a frame it read correctly and the parser
 * threw away. The image alone cannot tell them apart — the same panel read
 * twice, one line apart, has gone from every material to none — and the note
 * ("0 materials, 77 lines") says only that something went wrong.
 *
 * So the client sends its lines with their boxes and what it built from them.
 * It is diagnostic rather than training data: the labels a model learns from
 * are still the corners a person marks.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('screenshot_submissions', function (Blueprint $table) {
            $table->json('reader_dump')->nullable()->after('submitter_note');
        });
    }

    public function down(): void
    {
        Schema::table('screenshot_submissions', function (Blueprint $table) {
            $table->dropColumn('reader_dump');
        });
    }
};
