<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/**
 * "Sign in with browser" for the desktop client, shaped like the OAuth
 * device flow (RFC 8628). The client asks for a pair of codes, opens the
 * website's /pair page with the short user code, and polls with the long
 * device code until the signed-in member approves. The device code is the
 * secret: it only ever travels in request bodies. The user code alone is
 * worthless without a signed-in approval.
 *
 * The typed pairing code (DeviceController) keeps working beside it.
 */
class DeviceAuthorizationController extends Controller
{
    private const TTL_SECONDS = 600;

    private const INTERVAL_SECONDS = 3;

    /** Client: start. Public. */
    public function start(Request $request)
    {
        $data = $request->validate(['device_name' => ['required', 'string', 'max:100']]);

        $deviceCode = Str::random(40);
        do {
            // Unambiguous alphabet: no 0/O, 1/I/L.
            $raw = collect(str_split('23456789ABCDEFGHJKMNPQRSTUVWXYZ'))->random(8)->implode('');
            $userCode = substr($raw, 0, 4).'-'.substr($raw, 4);
        } while (Cache::has("devauth-user:{$userCode}"));

        $expires = now()->addSeconds(self::TTL_SECONDS);
        Cache::put("devauth:{$deviceCode}", [
            'user_code' => $userCode,
            'device_name' => $data['device_name'],
            'user_id' => null,
            'denied' => false,
            'polled_at' => 0,
            'expires_at' => $expires->toIso8601String(),
        ], $expires);
        Cache::put("devauth-user:{$userCode}", $deviceCode, $expires);

        $page = rtrim((string) config('app.url'), '/').'/pair';

        return [
            'device_code' => $deviceCode,
            'user_code' => $userCode,
            'verification_uri' => $page,
            'verification_uri_complete' => $page.'?code='.$userCode,
            'expires_in' => self::TTL_SECONDS,
            'interval' => self::INTERVAL_SECONDS,
        ];
    }

    /** Website: what is asking to connect. Signed in. */
    public function show(string $userCode)
    {
        [, $entry] = $this->byUserCode($userCode);

        return [
            'user_code' => $entry['user_code'],
            'device_name' => $entry['device_name'],
            'expires_at' => $entry['expires_at'],
            'status' => $entry['denied'] ? 'denied' : ($entry['user_id'] ? 'approved' : 'pending'),
        ];
    }

    /** Website: approve or deny. Signed in. */
    public function decide(Request $request, string $userCode)
    {
        $data = $request->validate(['approve' => ['required', 'boolean']]);
        [$deviceCode, $entry] = $this->byUserCode($userCode);
        abort_if($entry['user_id'] !== null || $entry['denied'], 409, 'This request was already answered.');

        if ($data['approve']) {
            $entry['user_id'] = $request->user()->id;
        } else {
            $entry['denied'] = true;
        }
        Cache::put("devauth:{$deviceCode}", $entry, now()->parse($entry['expires_at']));

        return ['status' => $data['approve'] ? 'approved' : 'denied'];
    }

    /** Client: poll for the token. Public. */
    public function token(Request $request)
    {
        $data = $request->validate(['device_code' => ['required', 'string', 'max:64']]);
        $key = "devauth:{$data['device_code']}";
        $entry = Cache::get($key);

        if ($entry === null) {
            return response()->json(['error' => 'expired_token'], 400);
        }
        if ($entry['denied']) {
            $this->forget($data['device_code'], $entry);

            return response()->json(['error' => 'access_denied'], 400);
        }
        if ($entry['user_id'] === null) {
            $now = microtime(true);
            $tooSoon = $now - $entry['polled_at'] < self::INTERVAL_SECONDS - 1;
            $entry['polled_at'] = $now;
            Cache::put($key, $entry, now()->parse($entry['expires_at']));

            return response()->json(['error' => $tooSoon ? 'slow_down' : 'authorization_pending'], 400);
        }

        // Approved: hand out the token once.
        $this->forget($data['device_code'], $entry);
        $user = User::findOrFail($entry['user_id']);
        $token = $user->createToken($entry['device_name'], ['ingest']);

        return [
            'token' => $token->plainTextToken,
            'user' => ['name' => $user->name, 'handle' => $user->handle],
        ];
    }

    /** @return array{0: string, 1: array<string, mixed>} */
    private function byUserCode(string $userCode): array
    {
        $code = strtoupper(trim($userCode));
        if (strlen($code) === 8 && ! str_contains($code, '-')) {
            $code = substr($code, 0, 4).'-'.substr($code, 4);
        }
        $deviceCode = Cache::get("devauth-user:{$code}");
        $entry = $deviceCode ? Cache::get("devauth:{$deviceCode}") : null;
        abort_if($entry === null, 404, 'This code is unknown or has expired. Start again in the desktop client.');

        return [$deviceCode, $entry];
    }

    private function forget(string $deviceCode, array $entry): void
    {
        Cache::forget("devauth:{$deviceCode}");
        Cache::forget("devauth-user:{$entry['user_code']}");
    }
}
