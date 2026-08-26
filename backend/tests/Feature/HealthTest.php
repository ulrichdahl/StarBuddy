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

    public function test_version_is_public(): void
    {
        config(['starbuddy.version' => '0.1.7+3 (abc1234)']);
        $this->getJson('/api/version')->assertOk()->assertJson(['name' => 'StarBuddy', 'version' => '0.1.7+3 (abc1234)']);
    }
}
