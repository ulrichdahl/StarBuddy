<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class BotToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = config('starmaker.bot_api_token');

        if (! $token || ! hash_equals($token, (string) $request->bearerToken())) {
            abort(401, 'Invalid bot token.');
        }

        return $next($request);
    }
}
