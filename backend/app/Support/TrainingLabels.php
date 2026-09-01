<?php

namespace App\Support;

/**
 * The label vocabulary for panel-detector training data.
 *
 * These lists are the encoding the model is trained against, so they must stay
 * in step with `ml/configs/stage_a.yaml`. Append only — reordering or renaming
 * a value silently relabels every screenshot already collected.
 */
class TrainingLabels
{
    /**
     * Panels we already know about.
     *
     * Not a closed set: a contributor can name a screen nobody has submitted
     * before, and it joins the vocabulary. This list only seeds the
     * autocomplete and fixes the order of the screens that existed first, so
     * an export's label encoding stays stable for the ones already collected.
     */
    public const SEEDED_SCREENS = [
        'freight_manager',
        'fabrication_kiosk_blueprints',
        'fabrication_kiosk_materials',
        'scanning_signature',
        'scan_result',
        'refinery_order',
        'inventory',
        'other',
        // Appended after 'other' on purpose. Position in this list is the
        // label the model is trained against, so a new screen goes on the end
        // even when it would read better next to a related one — inserting it
        // would renumber every screen after it and invalidate earlier runs.
        'kiosk_prices',
        'refinery_status',
        'ship_cargo',
        'shop_inventory',
    ];

    /**
     * Named HUD colour buckets.
     *
     * Contributors sample the colour off the panel and the app derives the
     * bucket; the raw hex is stored beside it. Unlike the screen list this one
     * is closed — it is the model's classification head, and a new bucket
     * would relabel every capture already collected.
     */
    public const HUD_COLOURS = ['amber', 'teal', 'blue', 'green', 'white', 'mixed', 'unknown'];

    public const STATUSES = ['pending', 'approved', 'rejected'];

    /**
     * Approved captures a screen needs before its class is worth trusting.
     *
     * The corner detector improves from every capture whatever the screen, but
     * the screen classifier needs volume per class: a screen with a handful of
     * examples gets guessed wrong no matter how large the collection is overall.
     */
    public const MIN_PER_SCREEN = 40;

    /**
     * The four corners of the panel, in the order the model expects.
     *
     * Contributors click in whatever order they like; this is the order the
     * quad is stored and exported in.
     */
    public const CORNERS = ['top_left', 'top_right', 'bottom_right', 'bottom_left'];

    /**
     * Sort four arbitrary points into TL, TR, BR, BL.
     *
     * In-world panels are never drawn rotated more than a few degrees, so x+y
     * is smallest at the top-left and largest at the bottom-right, and x-y
     * separates the remaining two. Mirrors `order_quad` in ml/src/starbuddy_ml.
     *
     * @param  array<int, array{0: float, 1: float}>  $points
     * @return array<int, array{0: float, 1: float}>
     */
    public static function orderQuad(array $points): array
    {
        $sums = array_map(fn ($p) => $p[0] + $p[1], $points);
        $diffs = array_map(fn ($p) => $p[0] - $p[1], $points);

        $topLeft = array_search(min($sums), $sums, true);
        $bottomRight = array_search(max($sums), $sums, true);

        $rest = array_values(array_diff(array_keys($points), [$topLeft, $bottomRight]));
        usort($rest, fn ($a, $b) => $diffs[$b] <=> $diffs[$a]);
        [$topRight, $bottomLeft] = $rest;

        return [
            $points[$topLeft],
            $points[$topRight],
            $points[$bottomRight],
            $points[$bottomLeft],
        ];
    }

    /**
     * Area of a quad, as a fraction of the whole image.
     *
     * Used to reject a quad that is too small to be a panel — usually a
     * contributor who clicked four times in the same spot by accident.
     *
     * @param  array<int, array{0: float, 1: float}>  $quad
     */
    public static function area(array $quad): float
    {
        $sum = 0.0;
        $count = count($quad);
        for ($i = 0; $i < $count; $i++) {
            [$x1, $y1] = $quad[$i];
            [$x2, $y2] = $quad[($i + 1) % $count];
            $sum += ($x1 * $y2) - ($x2 * $y1);
        }

        return abs($sum) / 2.0;
    }

    /**
     * Fold a typed screen or ship name into the corpus convention: lowercase,
     * underscores, no punctuation.
     *
     * Without this, "Freight Manager", "freight manager" and "freight_manager"
     * become three separate classes the model has to learn separately from a
     * third of the examples each.
     */
    public static function normaliseName(string $value): string
    {
        $value = strtolower(trim($value));
        $value = preg_replace('/[^a-z0-9]+/', '_', $value) ?? '';

        return trim($value, '_');
    }

    /**
     * The screen vocabulary in a stable order: the seeded panels first, then
     * anything contributors have named since, oldest first.
     *
     * Order is the label encoding, so it must never depend on how many
     * captures each screen happens to have.
     *
     * @param  array<int, string>  $observed  screens present in the data, oldest first
     * @return array<int, string>
     */
    public static function screenVocabulary(array $observed): array
    {
        $vocabulary = self::SEEDED_SCREENS;
        foreach ($observed as $screen) {
            if (! in_array($screen, $vocabulary, true)) {
                $vocabulary[] = $screen;
            }
        }

        return $vocabulary;
    }
}
