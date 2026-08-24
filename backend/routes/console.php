<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

use Illuminate\Support\Facades\Schedule;

// Keep the recipe database current; game patches change blueprints.
Schedule::command('starmaker:sync-blueprints')->dailyAt('05:00');
Schedule::command('starmaker:sync-resource-types')->dailyAt('05:15');
