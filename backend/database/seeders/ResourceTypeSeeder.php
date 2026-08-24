<?php

namespace Database\Seeders;

use App\Models\ResourceType;
use Illuminate\Database\Seeder;

/**
 * Baseline resource catalog. Quality values are learned in the field
 * (per-resource bands — see spec §02), so known_qualities starts empty.
 * The list follows the Alpha 4.9 mineable/refined/salvage/gem sets; extend
 * freely — imports and the entry UI only accept resources present here.
 */
class ResourceTypeSeeder extends Seeder
{
    public function run(): void
    {
        $catalog = [
            'ore' => [
                'Agricium (Ore)', 'Aluminum (Ore)', 'Beryl (Ore)', 'Bexalite (Ore)',
                'Borase (Ore)', 'Copper (Ore)', 'Corundum (Ore)', 'Gold (Ore)',
                'Hephaestanite (Ore)', 'Iron (Ore)', 'Laranite (Ore)', 'Quantainium (Ore)',
                'Quartz (Ore)', 'Silicon (Ore)', 'Stileron (Ore)', 'Taranite (Ore)',
                'Tin (Ore)', 'Titanium (Ore)', 'Tungsten (Ore)', 'Riccite (Ore)',
                'Ice',
            ],
            'refined' => [
                'Agricium', 'Aluminum', 'Beryl', 'Bexalite', 'Borase', 'Copper',
                'Corundum', 'Gold', 'Hephaestanite', 'Iron', 'Laranite', 'Quantainium',
                'Quartz', 'Silicon', 'Stileron', 'Taranite', 'Tin', 'Titanium',
                'Tungsten', 'Riccite', 'Steel', 'Aslarite', 'Antium', 'Mercury',
            ],
            'salvage' => [
                'Recycled Material Composite', 'Construction Materials',
            ],
            'gem' => [
                'Hadanite', 'Aphorite', 'Dolivine', 'Janalite', 'Beradom', 'Glacosite',
            ],
        ];

        foreach ($catalog as $category => $names) {
            foreach ($names as $name) {
                ResourceType::firstOrCreate(
                    ['name' => $name],
                    [
                        'category' => $category,
                        'unit' => $category === 'gem' ? 'pieces' : 'mscu',
                        'known_qualities' => [],
                    ],
                );
            }
        }
    }
}
