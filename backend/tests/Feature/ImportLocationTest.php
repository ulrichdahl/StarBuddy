<?php

namespace Tests\Feature;

use App\Models\Location;
use App\Models\Org;
use App\Models\ResourceStack;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * An import files material at a place. The catalogue is the list of places, so
 * a row naming anything else is an error the importer can see and fix — not a
 * new location nobody else can file anything under.
 */
class ImportLocationTest extends TestCase
{
    use RefreshDatabase;

    private User $me;

    protected function setUp(): void
    {
        parent::setUp();
        $org = Org::create(['name' => 'Stellar Forge']);
        $this->me = User::factory()->create(['discord_id' => '1', 'handle' => 'DK-Raven']);
        $org->memberships()->attach($this->me->id, ['role' => 'member', 'status' => 'active']);

        DB::table('resource_types')->insert([
            'name' => 'Iron', 'category' => 'refined', 'unit' => 'mscu',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        Location::create(['kind' => 'station', 'system' => 'Nyx', 'name' => 'Levski']);
    }

    private function preview(string $csv): array
    {
        return $this->actingAs($this->me)
            ->post('/api/import/resources/preview', [
                'file' => UploadedFile::fake()->createWithContent('stock.csv', $csv),
            ])
            ->assertOk()
            ->json();
    }

    public function test_a_row_naming_a_place_the_catalogue_does_not_list_is_an_error(): void
    {
        $preview = $this->preview("location,resource,quality,quantity\nMy secret cave,Iron,800,2\n");

        $this->assertSame(0, $preview['valid_count']);
        $this->assertStringContainsString('Unknown location', $preview['rows'][0]['errors'][0]);
        $this->assertSame(1, Location::count(), 'a preview invents nothing');
    }

    public function test_a_catalogue_place_imports_however_it_is_spelled(): void
    {
        $preview = $this->preview("location,resource,quality,quantity\nlevski,Iron,800,2\n");
        $this->assertSame(1, $preview['valid_count']);

        $this->actingAs($this->me)
            ->postJson('/api/import/resources/commit', ['token' => $preview['token']])
            ->assertOk();

        $this->assertSame(1, Location::count());
        $this->assertSame('Levski', ResourceStack::sole()->location->name);
    }
}
