<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // The instance always sits behind a reverse proxy (Caddy in compose,
        // plus the operator's SSL proxy in production) — trust forwarded
        // scheme/host headers so https APP_URLs and OAuth redirects work.
        $middleware->trustProxies(at: '*');
        $middleware->statefulApi();
        $middleware->alias([
            'bot' => \App\Http\Middleware\BotToken::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
