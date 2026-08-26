<?php

namespace Tests\Feature;

use Tests\TestCase;

// The SPA is served by Caddy, not Laravel, so "/" is not a Laravel route;
// /up is the uptime endpoint operators are told to monitor.
class HealthTest extends TestCase
{
    public function test_uptime_endpoint_answers(): void
    {
        $this->get('/up')->assertOk();
    }
}
