<?php

use App\Http\Controllers\AdminInventoryController;
use App\Http\Controllers\BlueprintController;
use App\Http\Controllers\BotController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\DeviceController;
use App\Http\Controllers\ImportController;
use App\Http\Controllers\IngestController;
use App\Http\Controllers\ItemController;
use App\Http\Controllers\ItemStackController;
use App\Http\Controllers\LocationController;
use App\Http\Controllers\RefineryOrderController;
use App\Http\Controllers\ResourceStackController;
use App\Http\Controllers\ResourceTypeController;
use App\Http\Controllers\ScreenshotCaptureController;
use App\Http\Controllers\ScreenshotSubmissionController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->group(function () {
    // orgs: the main org first, so orgs[0] is the main org. main_org_id is
    // repaired here too, should an org have been deleted.
    Route::get('me', function (Request $request) {
        $user = $request->user();
        $main = $user->ensureMainOrg();
        $user->load('orgs');
        $user->setRelation('orgs', $user->orgs->sortBy(fn ($o) => [$o->id === $main ? 0 : 1, $o->id])->values());

        return $user;
    });
    Route::get('me/udi-link', [\App\Http\Controllers\UdiLinkController::class, 'show']);
    Route::get('me/udi-link/status', [\App\Http\Controllers\UdiLinkController::class, 'status'])->middleware('throttle:30,1');
    Route::put('me/udi-link', [\App\Http\Controllers\UdiLinkController::class, 'adopt']);
    Route::delete('me/udi-link', [\App\Http\Controllers\UdiLinkController::class, 'destroy']);
    Route::put('me/main-org', [\App\Http\Controllers\OrgController::class, 'setMain']);
    Route::patch('me', [\App\Http\Controllers\ProfileController::class, 'update']);
    // The member's own data, as one file, or the whole account gone.
    Route::get('me/export', [\App\Http\Controllers\AccountController::class, 'export'])->middleware('throttle:6,1');
    Route::delete('me', [\App\Http\Controllers\AccountController::class, 'destroy'])->middleware('throttle:6,1');

    Route::get('dashboard', DashboardController::class);
    Route::get('dashboard/competition', \App\Http\Controllers\CompetitionController::class);
    Route::get('dashboard/members', [\App\Http\Controllers\CompetitionController::class, 'members']);
    Route::get('status', \App\Http\Controllers\StatusController::class);
    Route::get('scan/signatures', [\App\Http\Controllers\ScanController::class, 'signatures']);
    Route::get('scan/signature/{value}', [\App\Http\Controllers\ScanController::class, 'lookup']);
    Route::get('craftability', \App\Http\Controllers\CraftabilityController::class);
    Route::get('craftability/{blueprint}', [\App\Http\Controllers\CraftabilityController::class, 'show']);
    Route::post('craftability/{blueprint}/craft', [\App\Http\Controllers\CraftabilityController::class, 'craft']);
    Route::post('crafts/{audit}/undo', [\App\Http\Controllers\CraftabilityController::class, 'undoCraft']);

    Route::get('resource-types', [ResourceTypeController::class, 'index']);
    // Locations are the shared catalogue only — players pick from it, nobody adds to it.
    Route::apiResource('locations', LocationController::class)->only(['index']);
    Route::apiResource('resource-stacks', ResourceStackController::class)->only(['index', 'store', 'update', 'destroy']);
    // Doing one thing to a whole hold — materials or items: moving it, or
    // handing it to another player.
    Route::post('stock-transfers/move', [\App\Http\Controllers\StockTransferController::class, 'move']);
    Route::post('stock-transfers/visibility', [\App\Http\Controllers\StockTransferController::class, 'visibility']);
    Route::post('stock-transfers', [\App\Http\Controllers\StockTransferController::class, 'hand']);
    Route::get('stock-transfers', [\App\Http\Controllers\StockTransferController::class, 'index']);
    Route::apiResource('item-stacks', ItemStackController::class)->only(['index', 'store', 'update', 'destroy']);
    Route::get('items', [ItemController::class, 'index']);
    // Org view: org-visible stacks grouped per item / material+quality, with per-member holdings.
    Route::get('org/items', [\App\Http\Controllers\OrgInventoryController::class, 'items']);
    Route::get('org/materials', [\App\Http\Controllers\OrgInventoryController::class, 'materials']);

    Route::get('blueprints', [BlueprintController::class, 'index']);
    Route::get('blueprints/catalog', [BlueprintController::class, 'catalog']);
    Route::get('blueprints/{blueprint}', [BlueprintController::class, 'show']);
    Route::post('blueprints-owned/toggle', [BlueprintController::class, 'toggleOwned']);
    Route::post('blueprints-owned/bulk', [BlueprintController::class, 'bulkOwned']);
    Route::post('blueprints-owned', [BlueprintController::class, 'storeOwned']);
    Route::delete('blueprints-owned/{blueprintOwned}', [BlueprintController::class, 'destroyOwned']);

    // What a player is working towards: blueprints pinned to craft (their
    // materials become the desktop client's gathering list) and mission
    // reward pools being farmed.
    Route::get('craft-targets', [\App\Http\Controllers\CraftTargetController::class, 'index']);
    Route::post('craft-targets', [\App\Http\Controllers\CraftTargetController::class, 'store']);
    Route::post('craft-targets/share', [\App\Http\Controllers\CraftTargetController::class, 'share'])->middleware('throttle:6,1');
    Route::delete('craft-targets/{blueprint}', [\App\Http\Controllers\CraftTargetController::class, 'destroy']);
    Route::get('tracked-pools', [\App\Http\Controllers\TrackedPoolController::class, 'index']);
    Route::post('tracked-pools', [\App\Http\Controllers\TrackedPoolController::class, 'store']);
    Route::delete('tracked-pools/{poolKey}', [\App\Http\Controllers\TrackedPoolController::class, 'destroy'])->where('poolKey', '.*');

    Route::get('refinery-orders', [RefineryOrderController::class, 'index']);
    Route::post('refinery-orders', [RefineryOrderController::class, 'store']);
    Route::get('refinery-orders/{refineryOrder}', [RefineryOrderController::class, 'show']);
    // An order the refinery is still holding can be corrected — a terminal is
    // read in a hurry, and the numbers are only worth having if a mistake can
    // be fixed. A collected one is history and stays as it was.
    Route::patch('refinery-orders/{refineryOrder}', [RefineryOrderController::class, 'update']);
    Route::delete('refinery-orders/{refineryOrder}', [RefineryOrderController::class, 'destroy']);
    // Collecting moves the order's materials out of the refinery to wherever
    // the player is putting them.
    Route::post('refinery-orders/{refineryOrder}/collect', [RefineryOrderController::class, 'collect']);

    // P1.1 — bulk CSV import of org resources
    Route::get('import/resources/template', [ImportController::class, 'template']);
    Route::post('import/resources/preview', [ImportController::class, 'preview']);
    Route::post('import/resources/commit', [ImportController::class, 'commit']);

    // P1.1 — bulk clear of org inventory by type/category
    Route::delete('admin/inventory', [AdminInventoryController::class, 'clear']);
    // Anyone can clear their own stock, e.g. after a game wipe.
    Route::delete('me/inventory', [AdminInventoryController::class, 'clearOwn']);

    // Orgs: browse/join for members, moderation for managers
    Route::get('orgs', [\App\Http\Controllers\OrgController::class, 'index']);
    Route::post('orgs/{org}/join', [\App\Http\Controllers\OrgController::class, 'join']);
    Route::delete('orgs/{org}/leave', [\App\Http\Controllers\OrgController::class, 'leave']);
    // Who is in my orgs, for picking a player to hand something to.
    Route::get('org/mates', [\App\Http\Controllers\OrgController::class, 'mates']);
    Route::get('orgs/{org}/members', [\App\Http\Controllers\OrgController::class, 'members']);
    Route::post('orgs/{org}/members/{user}/accept', [\App\Http\Controllers\OrgController::class, 'accept']);
    Route::delete('orgs/{org}/members/{user}', [\App\Http\Controllers\OrgController::class, 'kick']);

    // Desktop client pairing (code generated in the web UI) + device management
    Route::post('devices/pairing-code', [DeviceController::class, 'pairingCode']);
    Route::get('devices', [DeviceController::class, 'index']);
    Route::delete('devices/{tokenId}', [DeviceController::class, 'destroy']);
    // "Sign in with browser": the member approves a desktop client on /pair.
    Route::get('devices/authorize/{userCode}', [\App\Http\Controllers\DeviceAuthorizationController::class, 'show'])->middleware('throttle:30,1');
    Route::post('devices/authorize/{userCode}', [\App\Http\Controllers\DeviceAuthorizationController::class, 'decide'])->middleware('throttle:30,1');

    // Game.log event ingestion from paired desktop clients (idempotent)
    Route::post('presence', [\App\Http\Controllers\PresenceController::class, 'store'])->middleware('throttle:20,1');
    Route::post('ingest/events', [IngestController::class, 'store']);

    // Scan training is for testers only (the tester role in the home guild).
    Route::middleware('tester')->group(function () {
        // Contributed screenshots for training the panel detector. Members submit
        // and see their own; managers review the queue and export the approved set.
        Route::get('training/labels', [ScreenshotSubmissionController::class, 'labels']);
        Route::get('training/screenshots', [ScreenshotSubmissionController::class, 'index']);
        Route::post('training/screenshots', [ScreenshotSubmissionController::class, 'store'])
            ->middleware('throttle:60,1');
        Route::get('training/screenshots/queue', [ScreenshotSubmissionController::class, 'queue']);
        Route::get('training/screenshots/export', [ScreenshotSubmissionController::class, 'export']);
        Route::get('training/screenshots/{submission}/image', [ScreenshotSubmissionController::class, 'image']);

        // Hotkey grabs from the desktop client: they arrive unlabelled, wait in the
        // player's own queue, and become ordinary submissions once labelled.
        Route::post('training/captures', [ScreenshotCaptureController::class, 'store'])
            ->middleware('throttle:120,1');
        Route::get('training/captures', [ScreenshotCaptureController::class, 'index']);
        Route::post('training/captures/{submission}/contribute', [ScreenshotCaptureController::class, 'contribute']);
        Route::delete('training/captures/{submission}', [ScreenshotCaptureController::class, 'destroy']);
        Route::patch('training/screenshots/{submission}', [ScreenshotSubmissionController::class, 'update']);
        Route::post('training/screenshots/{submission}/review', [ScreenshotSubmissionController::class, 'review']);
    });
});

// What the sign-in page needs to know about this instance — public.
Route::get('instance', \App\Http\Controllers\InstanceController::class)->middleware('throttle:60,1');

// Deployed version for footers and support requests — public, no auth needed.
Route::get('version', fn () => ['name' => 'StarBuddy', 'version' => config('starbuddy.version')])->middleware('throttle:60,1');

// The latest desktop client installers, for a direct download per platform — public.
Route::get('client/latest', \App\Http\Controllers\ClientReleaseController::class)->middleware('throttle:60,1');

// The desktop client exchanges a short-lived pairing code for its device token.
Route::post('devices/pair', [DeviceController::class, 'pair'])->middleware('throttle:10,1');
// "Sign in with browser" (device flow): the client starts, then polls for its token.
Route::post('devices/authorize', [\App\Http\Controllers\DeviceAuthorizationController::class, 'start'])->middleware('throttle:10,1');
Route::post('devices/token', [\App\Http\Controllers\DeviceAuthorizationController::class, 'token'])->middleware('throttle:40,1');

// Internal service API for the Discord bot (token-authenticated, not exposed publicly).
Route::prefix('bot')->middleware('bot')->group(function () {
    Route::get('health', [BotController::class, 'health']);
    Route::get('status', \App\Http\Controllers\StatusController::class);
    Route::get('member/{discordId}', [BotController::class, 'member']);
    Route::get('craftable/{discordId}', [BotController::class, 'craftable']);
    Route::get('need/{discordId}', [BotController::class, 'need']);
    // Org administration — the bot enforces Discord ManageGuild first.
    Route::get('orgs', [BotController::class, 'listOrgs']);
    Route::post('orgs', [BotController::class, 'createOrg']);
    Route::delete('orgs/{name}', [BotController::class, 'deleteOrg']);
    Route::post('orgs/{name}/manager', [BotController::class, 'setManager']);
});
