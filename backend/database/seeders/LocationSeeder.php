<?php

namespace Database\Seeders;

use App\Models\Location;
use Illuminate\Database\Seeder;

/**
 * Shared landing-zone locations (user_id and org_id both null — visible to
 * everyone). Members reference these by simple name ("Levski"); personal
 * locations (ships, bases) remain per-user.
 */
class LocationSeeder extends Seeder
{
    public function run(): void
    {
        $landingZones = [
            'Stanton' => [
                'Area18', 'Lorville', 'New Babbage', 'Orison', 'GrimHEX',
                'Everus Harbor', 'Baijini Point', 'Port Tressler', 'Seraphim Station',
            ],
            'Nyx' => ['Levski'],
            'Pyro' => ['Ruin Station', 'Checkmate', 'Patch City', 'Orbituary', 'Endgame'],
        ];

        foreach ($landingZones as $system => $names) {
            foreach ($names as $name) {
                Location::firstOrCreate(
                    ['name' => $name, 'user_id' => null, 'org_id' => null],
                    ['kind' => 'landing_zone', 'station' => $system],
                );
            }
        }
    }
}
