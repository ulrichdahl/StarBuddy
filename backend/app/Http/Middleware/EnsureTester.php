<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Features still being tried out (scan training) are only for members
 * holding the tester role in the home Discord guild.
 */
class EnsureTester
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->user()?->isTester()) {
            return response()->json([
                'message' => 'This feature is only for testers.',
                'code' => 'tester_only',
            ], 403);
        }

        return $next($request);
    }
}
