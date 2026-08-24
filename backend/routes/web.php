<?php

use App\Http\Controllers\AuthController;
use Illuminate\Support\Facades\Route;

// Discord OAuth lives on the web (session) middleware group. The SPA is
// served by Caddy; the backend only answers /api, /sanctum and /auth paths.
Route::prefix('api/auth')->group(function () {
    Route::get('discord/redirect', [AuthController::class, 'redirect']);
    Route::get('discord/callback', [AuthController::class, 'callback']);
    Route::post('logout', [AuthController::class, 'logout'])->middleware('auth');
});
