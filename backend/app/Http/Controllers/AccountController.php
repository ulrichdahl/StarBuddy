<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;

/**
 * A member's own data: all of it as one JSON file, or the whole account
 * gone. Not needed for a hobby community, but a good service all the same.
 */
class AccountController extends Controller
{
    /** Tables that hold a member's own rows in user_id. */
    private const OWN_TABLES = [
        'blueprint_owned', 'craft_targets', 'ingest_events', 'item_stacks', 'locations',
        'org_members', 'refinery_orders', 'resource_stacks', 'score_events',
        'screenshot_submissions', 'tracked_pools', 'user_game_accounts', 'user_presence',
    ];

    /** Secrets and internals that never leave the server, even to their owner. */
    private const HIDDEN = ['password', 'remember_token', 'udi_link_token', 'image_path', 'token'];

    /** GET /api/me/export: everything StarBuddy keeps about the member, as a download. */
    public function export(Request $request)
    {
        $user = $request->user();
        $strip = fn ($row) => array_diff_key((array) $row, array_flip(self::HIDDEN));

        $tables = [];
        foreach (self::OWN_TABLES as $table) {
            $tables[$table] = DB::table($table)->where('user_id', $user->id)->orderBy('id')->get()->map($strip)->all();
        }
        $tables['org_members'] = array_map(
            fn ($row) => $row + ['org_name' => DB::table('orgs')->where('id', $row['org_id'])->value('name')],
            $tables['org_members'],
        );
        $tables['stock_transfers'] = DB::table('stock_transfers')
            ->where('user_id', $user->id)->orWhere('to_user_id', $user->id)->orderBy('id')->get()->map($strip)->all();
        $tables['paired_devices'] = DB::table('personal_access_tokens')
            ->where('tokenable_type', User::class)->where('tokenable_id', $user->id)
            ->orderBy('id')->get(['name', 'last_used_at', 'created_at', 'expires_at'])->map($strip)->all();
        $tables['sessions'] = DB::table('sessions')->where('user_id', $user->id)
            ->get(['ip_address', 'user_agent', 'last_activity'])->map($strip)->all();

        $data = [
            'exported_at' => now()->toIso8601String(),
            'instance' => config('app.url'),
            'account' => $strip($user->getAttributes()) + ['udi_linked' => (bool) $user->udi_link_token],
            'data' => $tables,
        ];

        return response()->json($data, 200, [
            'Content-Disposition' => 'attachment; filename="starbuddy-'.$user->id.'-'.now()->format('Ymd').'.json"',
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /**
     * DELETE /api/me: the account and everything that is the member's own.
     * Their stock, blueprints, orders, points and screenshots go with it
     * (cascades); shared records like audit logs keep the row without them.
     */
    public function destroy(Request $request)
    {
        $request->validate(['confirm' => ['required', 'in:DELETE']]);
        $user = $request->user();

        // The UDI settings too, as far as UDI can be reached: once the account
        // is gone, nobody holds the token to ask again.
        if ($user->udi_link_token) {
            try {
                Http::withToken($user->udi_link_token)->acceptJson()->timeout(5)
                    ->delete(config('starbuddy.udi_url').'/api/starbuddy/profile');
            } catch (\Throwable) {
                // Unreachable: the settings there can no longer be fetched by anyone.
            }
        }

        $images = DB::table('screenshot_submissions')->where('user_id', $user->id)->pluck('image_path')->filter()->all();

        DB::transaction(function () use ($user) {
            $user->tokens()->delete();
            DB::table('sessions')->where('user_id', $user->id)->delete();
            $user->delete();
        });
        Storage::disk('local')->delete($images);

        // Not logout(): it saves a fresh remember token on the user, which
        // would write the deleted account straight back.
        Auth::guard('web')->forgetUser();
        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        return response()->noContent();
    }
}
