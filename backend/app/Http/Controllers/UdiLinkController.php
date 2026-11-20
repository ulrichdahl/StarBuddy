<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

/**
 * The player's link to the UDI StarLabels/StarConfig tools on
 * uniteddanes.org. One token per player, kept here so the link follows the
 * account to every paired PC; the desktop client fetches global.ini and
 * user.cfg from UDI with it.
 *
 * The token is a bearer secret (contract: 32 random bytes, base64url, 43
 * characters). It is never logged and never put in a URL query; the setup
 * page takes it in the URL fragment.
 */
class UdiLinkController extends Controller
{
    /** GET /api/me/udi-link: the token, made on the first call. */
    public function show(Request $request)
    {
        $user = $request->user();
        if (! $user->udi_link_token) {
            $user->forceFill([
                'udi_link_token' => rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '='),
                'udi_linked_at' => now(),
            ])->save();
        }

        return response()->json([
            'token' => $user->udi_link_token,
            'created_at' => $user->udi_linked_at?->toIso8601String(),
            'setup_url' => self::setupUrls(),
        ])->header('Cache-Control', 'no-store');
    }

    /**
     * PUT /api/me/udi-link {token}: adopt a token a desktop client minted
     * before the server had one, so a setup already done under it is kept.
     * 409 when the account already has a different token: use that one.
     */
    public function adopt(Request $request)
    {
        $token = $request->validate(['token' => ['required', 'string', 'regex:/^[A-Za-z0-9_-]{43}$/']])['token'];
        $user = $request->user();
        if ($user->udi_link_token && ! hash_equals($user->udi_link_token, $token)) {
            return response()->json(['message' => 'This account already has a UDI link token.'], 409);
        }
        if (! $user->udi_link_token) {
            $user->forceFill(['udi_link_token' => $token, 'udi_linked_at' => now()])->save();
        }

        return $this->show($request);
    }

    /**
     * GET /api/me/udi-link/status: whether the player has sent settings from
     * the UDI page yet, without handing out the token. profile is UDI's
     * profile ({revision, updated_at, channel, labels, config}) or null.
     */
    public function status(Request $request)
    {
        $user = $request->user();
        if (! $user->udi_link_token) {
            return ['linked' => false, 'profile' => null, 'reachable' => null];
        }

        try {
            $res = Http::withToken($user->udi_link_token)->acceptJson()->timeout(5)
                ->get(config('starbuddy.udi_url').'/api/starbuddy/profile');
        } catch (\Throwable) {
            return ['linked' => true, 'profile' => null, 'reachable' => false];
        }

        return [
            'linked' => true,
            'profile' => $res->successful() ? $res->json() : null,
            'reachable' => $res->successful() || $res->status() === 404,
        ];
    }

    /**
     * DELETE /api/me/udi-link: unlink. Deletes the settings stored under the
     * token at UDI, the only place they are deleted (the UDI page's "forget"
     * is local to that browser), then forgets the token; installed files
     * stay. When UDI cannot be reached the token is kept and 502 says try
     * again, so the settings are never left behind under a lost token.
     */
    public function destroy(Request $request)
    {
        $user = $request->user();
        if ($user->udi_link_token) {
            try {
                $res = Http::withToken($user->udi_link_token)->acceptJson()->timeout(5)
                    ->delete(config('starbuddy.udi_url').'/api/starbuddy/profile');
                // 404: UDI never knew the token; nothing to delete there.
                $gone = $res->successful() || $res->status() === 404;
            } catch (\Throwable) {
                $gone = false;
            }
            if (! $gone) {
                return response()->json(['message' => 'UDI could not be reached. Try again later.', 'code' => 'udi_unreachable'], 502);
            }
            $user->forceFill(['udi_link_token' => null, 'udi_linked_at' => null])->save();
        }

        return response()->noContent();
    }

    /** The setup page per language; the token goes in the fragment: <url>#starbuddy=<token>. */
    public static function setupUrls(): array
    {
        $base = config('starbuddy.udi_url');

        return [
            'da' => "{$base}/vaerktoej/star-labels",
            'en' => "{$base}/en/tools/star-labels",
            'de' => "{$base}/de/werkzeuge/star-labels",
        ];
    }
}
