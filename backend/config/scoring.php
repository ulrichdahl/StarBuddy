<?php

/*
 * Points for Game.log activity, the org leaderboard's only input. Change the
 * values, bump the version and run `php artisan score:recount`.
 */
return [
    'version' => 1,

    'points' => [
        'mission_completed' => 10,
        'refinery_completed' => 5,
        // A place counts once per player per calendar month.
        'place' => ['stanton' => 3, 'nyx' => 5, 'pyro' => 8, 'default' => 3],
        'jurisdiction' => 2,
    ],

    // Quantum destinations that are made up on the spot: mission beacons,
    // party markers, dropped nav points. Visiting them is no new place.
    'ignore_places' => [
        '/^mission_qt_/i',
        '/^partymembermarker_/i',
        '/^navpoint_dynamic/i',
        '/^unattendedvehiclemarker_/i',
        '/\.socpak$/i',
        '/_\d{9,}$/',
    ],

    // Which system a place or jurisdiction is in, first match wins. Pyro
    // comes first so a jump point between Nyx and Pyro scores as Pyro.
    'systems' => [
        'pyro' => '/pyro/i',
        'nyx' => '/nyx|levski|keeger|castra|people\'?s alliance/i',
        'stanton' => '/stanton|area18|lorville|orison|new ?babbage|grimhex|arccorp|hurston|crusader|microtech|^(loc_)?rr_(s\d|arc|hur|cru|mic|p\d)|uee/i',
    ],

    // A player whose log names a different character than their handle
    // scores nothing for those events.
    'require_character_match' => true,
];
