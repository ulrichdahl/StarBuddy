<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Crafted items carry a quality the way materials do — bought or crafted gear
// is worth recording at its grade.
//
// Until now a craft wrote the grade into the name as "Arclight Pistol (Q905)",
// because there was nowhere else to put it. Those suffixes move into the new
// column and the names go back to what the blueprint calls them; everything
// else is game-spawned, so it lands on the standard grade of 500.
return new class extends Migration
{
    /** "Arclight Pistol (Q905)" → ["Arclight Pistol", 905] */
    private const SUFFIX = '/^(.*?)\s*\(Q(\d{1,4})\)\s*$/';

    /** What items spawn at in game, and so what an ungraded stack is worth. */
    private const SPAWN_GRADE = 500;

    public function up(): void
    {
        Schema::table('item_stacks', function (Blueprint $table) {
            $table->unsignedSmallInteger('quality')->nullable()->after('item_name');
        });

        // Done in PHP rather than one regex UPDATE so it behaves the same on
        // Postgres and on the SQLite the tests run against.
        DB::table('item_stacks')
            ->whereNotNull('item_name')
            ->where('item_name', 'like', '%(Q%)%')
            ->orderBy('id')
            ->each(function ($stack) {
                if (! preg_match(self::SUFFIX, $stack->item_name, $found)) {
                    return;
                }
                $quality = (int) $found[2];
                if ($quality > 1000) {
                    return; // not a grade — leave the name alone
                }
                DB::table('item_stacks')->where('id', $stack->id)->update([
                    'item_name' => $found[1],
                    'quality' => $quality,
                ]);
            });

        // Everything that never carried a grade is a plain in-game drop.
        DB::table('item_stacks')->whereNull('quality')->update(['quality' => self::SPAWN_GRADE]);
    }

    public function down(): void
    {
        // Put the grade back where it used to live, so a rollback loses nothing.
        // The ones sitting on the spawn grade are the ones this migration set,
        // so they go back to a bare name rather than gaining a suffix they
        // never had — at the cost of a genuine "(Q500)" craft, if one exists.
        DB::table('item_stacks')
            ->whereNotNull('quality')
            ->where('quality', '!=', self::SPAWN_GRADE)
            ->whereNotNull('item_name')
            ->orderBy('id')
            ->each(fn ($stack) => DB::table('item_stacks')
                ->where('id', $stack->id)
                ->update(['item_name' => $stack->item_name." (Q{$stack->quality})"]));

        Schema::table('item_stacks', function (Blueprint $table) {
            $table->dropColumn('quality');
        });
    }
};
