<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/**
 * Desktop client pairing. A logged-in member generates a short-lived code in
 * the web UI; the desktop client exchanges it (unauthenticated) for a
 * long-lived Sanctum device token. Codes are single-use and expire fast.
 */
class DeviceController extends Controller
{
    private const CODE_TTL_MINUTES = 10;

    public function pairingCode(Request $request)
    {
        // Unambiguous alphabet: no 0/O, 1/I/L.
        $code = collect(str_split('23456789ABCDEFGHJKMNPQRSTUVWXYZ'))
            ->random(8)
            ->implode('');

        Cache::put("pair:{$code}", $request->user()->id, now()->addMinutes(self::CODE_TTL_MINUTES));

        return [
            'code' => $code,
            'expires_at' => now()->addMinutes(self::CODE_TTL_MINUTES)->toIso8601String(),
        ];
    }

    public function pair(Request $request)
    {
        $data = $request->validate([
            'code' => ['required', 'string', 'max:16'],
            'device_name' => ['required', 'string', 'max:100'],
        ]);

        $userId = Cache::pull('pair:'.strtoupper(trim($data['code'])));
        abort_if($userId === null, 410, 'Pairing code is invalid or expired — generate a new one in the web app.');

        $user = \App\Models\User::findOrFail($userId);
        $token = $user->createToken($data['device_name'], ['ingest']);

        return [
            'token' => $token->plainTextToken,
            'user' => ['name' => $user->name, 'handle' => $user->handle],
        ];
    }

    public function index(Request $request)
    {
        return $request->user()->tokens()
            ->select('id', 'name', 'last_used_at', 'created_at')
            ->orderByDesc('created_at')
            ->get();
    }

    public function destroy(Request $request, int $tokenId)
    {
        $request->user()->tokens()->where('id', $tokenId)->delete();

        return response()->noContent();
    }
}
