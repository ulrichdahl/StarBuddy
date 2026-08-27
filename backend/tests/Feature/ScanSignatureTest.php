<?php

namespace Tests\Feature;

use App\Models\ResourceType;
use App\Models\User;
use App\Support\ScanSignatures;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ScanSignatureTest extends TestCase
{
    use RefreshDatabase;

    public function test_single_rock_matches_its_mineral(): void
    {
        $m = ScanSignatures::match(3400);
        $this->assertCount(1, $m, 'near misses (Riccite 3385, Ouratite 3370) must not compete with an exact match');
        $this->assertSame('Lindinium', $m[0]['name']);
        $this->assertSame(1, $m[0]['count']);
        $this->assertTrue($m[0]['exact']);
    }

    public function test_cluster_sum_is_a_multiple(): void
    {
        $m = collect(ScanSignatures::match(18000));
        $bex = $m->firstWhere('name', 'Bexalite');
        $this->assertSame(5, $bex['count']);
        $this->assertTrue($bex['exact']);
        // Exact multiples rank before near-misses.
        $this->assertTrue($m->first()['exact']);
    }

    public function test_ground_deposits_are_size_only(): void
    {
        $m = ScanSignatures::match(4000);
        $this->assertSame('roc', $m[0]['kind']);
        $this->assertSame(1, $m[0]['count']);
    }

    public function test_ocr_slip_still_matches_approximately(): void
    {
        $m = ScanSignatures::match(3610);
        $this->assertSame('Bexalite', $m[0]['name']);
        $this->assertFalse($m[0]['exact']);
        $this->assertSame(10, $m[0]['delta']);
        $this->assertSame([], ScanSignatures::match(1000));
    }

    public function test_sync_attaches_signatures_and_table_is_served(): void
    {
        ResourceType::create(['name' => 'Bexalite (Raw)', 'category' => 'ore', 'rarity' => 'uncommon', 'known_qualities' => [302, 1000]]);
        ResourceType::create(['name' => 'Bexalite (Ore)', 'category' => 'ore']);
        ResourceType::create(['name' => 'Bexalite', 'category' => 'refined']);
        $this->artisan('starbuddy:sync-scan-signatures')->assertSuccessful();

        $this->assertSame(3600, ResourceType::where('name', 'Bexalite (Raw)')->value('scan_signature'));
        $this->assertSame(3600, ResourceType::where('name', 'Bexalite (Ore)')->value('scan_signature'));
        $this->assertNull(ResourceType::where('name', 'Bexalite')->value('scan_signature'));

        Sanctum::actingAs(User::factory()->create(['discord_id' => '1']));
        $table = $this->getJson('/api/scan/signatures')->assertOk()->json();
        $bex = collect($table['ores'])->firstWhere('name', 'Bexalite');
        $this->assertSame('uncommon', $bex['rarity']);
        $this->assertSame([302, 1000], $bex['qualities']);
        $this->assertSame(3000, $table['ground']['fps']);

        $this->getJson('/api/scan/signature/3,400')->assertOk()->assertJsonPath('matches.0.name', 'Lindinium');
    }

    public function test_lookup_requires_auth(): void
    {
        $this->getJson('/api/scan/signature/3400')->assertUnauthorized();
    }
}
