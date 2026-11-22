<?php

namespace App\Providers;

use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;
use SocialiteProviders\Discord\DiscordExtendSocialite;
use SocialiteProviders\Manager\SocialiteWasCalled;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        Event::listen(SocialiteWasCalled::class, DiscordExtendSocialite::class.'@handle');

        // Behind a TLS-terminating proxy the request can reach PHP as plain
        // http; an https site never builds an http link (a redirect to
        // http://host:443/ is a 404 at the proxy).
        if (str_starts_with((string) config('app.url'), 'https://')) {
            URL::forceScheme('https');
        }
    }
}
