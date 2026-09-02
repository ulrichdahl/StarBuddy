<?php

namespace App\Support;

use App\Models\ResourceType;

/**
 * Turning what a refinery terminal printed into stacks StarBuddy can hold.
 *
 * Two mismatches sit between the two: the terminal counts in centi-SCU while
 * stacks are stored in milli-SCU or pieces, and it names the refined metal
 * ("CORUNDUM") where the catalogue names the ore it came from ("Corundum Ore").
 */
class RefineryYield
{
    /** How many mSCU one unit of the terminal's counting is worth. */
    private const IN_MSCU = ['scu' => 1000, 'cscu' => 10, 'mscu' => 1];

    /**
     * Convert an amount the terminal printed into the stack's own unit.
     *
     * Returns null when the amount would round to nothing — a fraction of a
     * milli-SCU is not a stack, and storing zero would claim the refinery
     * produced something it did not.
     */
    public static function toStackQuantity(float $amount, string $unit, ResourceType $type): ?int
    {
        if ($amount <= 0) {
            return null;
        }
        if ($type->unit === 'pieces') {
            $pieces = (int) round($amount);

            return $pieces > 0 ? $pieces : null;
        }

        $factor = self::IN_MSCU[strtolower($unit)] ?? self::IN_MSCU['cscu'];
        $mscu = (int) round($amount * $factor);

        return $mscu > 0 ? $mscu : null;
    }

    /**
     * The catalogue entry a refined material belongs to.
     *
     * Two things make this more than a name lookup. The terminal prints the
     * *refined* name while the catalogue usually holds the ore it came from, so
     * "CORUNDUM" has to find "Corundum Ore" — "Ore" marks the unrefined form,
     * and a refined material never carries it, which is what makes dropping it
     * safe rather than lossy. And the names themselves come from the game's
     * global.ini, which players replace: a localisation mod can strip "Ore"
     * from every name, so neither side can be assumed to have it.
     *
     * So both sides are reduced to the same bare form and compared there. The
     * catalogue is a few dozen rows, so it is compared in PHP rather than
     * contorting the comparison into SQL that has to work on two drivers.
     */
    public static function resolveType(string $name): ?ResourceType
    {
        $needle = self::normalise($name);
        if ($needle === '') {
            return null;
        }

        $matches = ResourceType::all(['id', 'name', 'unit', 'category'])
            ->filter(fn (ResourceType $type) => self::normalise($type->name) === $needle);

        if ($matches->isEmpty()) {
            return null;
        }

        // An exact name wins over one that only matches once reduced, so a
        // catalogue holding both "Corundum" and "Corundum Ore" resolves the one
        // actually written; otherwise the plainest name is the safer guess.
        return $matches->first(fn (ResourceType $type) => strcasecmp($type->name, trim($name)) === 0)
            ?? $matches->sortBy(fn (ResourceType $type) => mb_strlen($type->name))->first();
    }

    /**
     * A name reduced to what it has in common across spellings and mods:
     * lowercase, no punctuation, and without the "Ore" that marks unrefined
     * material.
     *
     * "Corundum Ore", "Iron (Ore)" and "CORUNDUM" all reduce to a bare name;
     * "Inert Materials" keeps both of its words, because only a standalone
     * "ore" is dropped and never part of another word.
     */
    private static function normalise(string $name): string
    {
        $lower = mb_strtolower(trim($name));
        $words = preg_split('/[^\p{L}\p{N}]+/u', $lower, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $bare = array_values(array_filter($words, fn ($word) => $word !== 'ore'));

        // A resource genuinely called "Ore" would reduce to nothing; keep it.
        return implode('', $bare === [] ? $words : $bare);
    }

}
