<?php

use App\Http\Controllers\AdminInventoryController;
use App\Http\Controllers\BlueprintController;
use App\Http\Controllers\BotController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\DeviceController;
use App\Http\Controllers\ImportController;
use App\Http\Controllers\IngestController;
use App\Http\Controllers\ItemStackController;
use App\Http\Controllers\LocationController;
use App\Http\Controllers\RefineryOrderController;
use App\Http\Controllers\ResourceStackController;
use App\Http\Controllers\ResourceTypeController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->group(function () {
    Route::get('me', fn (Request $request) => $request->user()->load('orgs'));
    Route::patch('me', [\App\Http\Controllers\ProfileController::class, 'update']);

    Route::get('dashboard', DashboardController::class);
    Route::get('craftability', \App\Http\Controllers\CraftabilityController::class);
    Route::get('craftability/{blueprint}', [\App\Http\Controllers\CraftabilityController::class, 'show']);
    Route::post('craftability/{blueprint}/craft', [\App\Http\Controllers\CraftabilityController::class, 'craft']);
    Route::post('crafts/{audit}/undo', [\App\Http\Controllers\CraftabilityController::class, 'undoCraft']);

    Route::get('resource-types', [ResourceTypeController::class, 'index']);
    Route::apiResource('locations', LocationController::class)->only(['index', 'store', 'update', 'destroy']);
    Route::apiResource('resource-stacks', ResourceStackController::class)->only(['index', 'store', 'update', 'destroy']);
    Route::apiResource('item-stacks', ItemStackController::class)->only(['index', 'store', 'update', 'destroy']);

    Route::get('blueprints', [BlueprintController::class, 'index']);
    Route::get('blueprints-owned', [BlueprintController::class, 'owned']);
    Route::post('blueprints-owned', [BlueprintController::class, 'storeOwned']);
    Route::delete('blueprints-owned/{blueprintOwned}', [BlueprintController::class, 'destroyOwned']);

    Route::get('refinery-orders', [RefineryOrderController::class, 'index']);
    Route::post('refinery-orders', [RefineryOrderController::class, 'store']);

    // P1.1 — bulk CSV import of org resources
    Route::get('import/resources/template', [ImportController::class, 'template']);
    Route::post('import/resources/preview', [ImportController::class, 'preview']);
    Route::post('import/resources/commit', [ImportController::class, 'commit']);

    // P1.1 — bulk clear of org inventory by type/category
    Route::delete('admin/inventory', [AdminInventoryController::class, 'clear']);

    // Orgs: browse/join for members, moderation for managers
    Route::get('orgs', [\App\Http\Controllers\OrgController::class, 'index']);
    Route::post('orgs/{org}/join', [\App\Http\Controllers\OrgController::class, 'join']);
    Route::delete('orgs/{org}/leave', [\App\Http\Controllers\OrgController::class, 'leave']);
    Route::get('orgs/{org}/members', [\App\Http\Controllers\OrgController::class, 'members']);
    Route::post('orgs/{org}/members/{user}/accept', [\App\Http\Controllers\OrgController::class, 'accept']);
    Route::delete('orgs/{org}/members/{user}', [\App\Http\Controllers\OrgController::class, 'kick']);

    // Desktop client pairing (code generated in the web UI) + device management
    Route::post('devices/pairing-code', [DeviceController::class, 'pairingCode']);
    Route::get('devices', [DeviceController::class, 'index']);
    Route::delete('devices/{tokenId}', [DeviceController::class, 'destroy']);

    // Game.log event ingestion from paired desktop clients (idempotent)
    Route::post('ingest/events', [IngestController::class, 'store']);
});

// The desktop client exchanges a short-lived pairing code for its device token.
Route::post('devices/pair', [DeviceController::class, 'pair'])->middleware('throttle:10,1');

// Internal service API for the Discord bot (token-authenticated, not exposed publicly).
Route::prefix('bot')->middleware('bot')->group(function () {
    Route::get('health', [BotController::class, 'health']);
    Route::get('member/{discordId}', [BotController::class, 'member']);
    // Org administration — the bot enforces Discord ManageGuild first.
    Route::get('orgs', [BotController::class, 'listOrgs']);
    Route::post('orgs', [BotController::class, 'createOrg']);
    Route::delete('orgs/{name}', [BotController::class, 'deleteOrg']);
    Route::post('orgs/{name}/manager', [BotController::class, 'setManager']);
});
