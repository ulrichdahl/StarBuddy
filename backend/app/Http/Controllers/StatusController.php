<?php

namespace App\Http\Controllers;

use App\Support\RsiStatus;

/**
 * Current RSI service status as mirrored by the poller — the same payload
 * for the web banner (session auth), the desktop client (device token)
 * and the Discord bot (bot token).
 */
class StatusController extends Controller
{
    public function __invoke()
    {
        return RsiStatus::current();
    }
}
