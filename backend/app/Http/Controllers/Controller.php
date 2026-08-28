<?php

namespace App\Http\Controllers;

abstract class Controller
{
    /** Page size from `per_page`, clamped to 10–200 — every list honours it. */
    protected function perPage(\Illuminate\Http\Request $request, int $default = 50): int
    {
        return min(200, max(10, (int) $request->query('per_page', $default)));
    }
    //
}
