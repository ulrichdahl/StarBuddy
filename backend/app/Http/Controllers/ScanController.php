<?php

namespace App\Http\Controllers;

use App\Support\ScanSignatures;
use Illuminate\Http\Request;

class ScanController extends Controller
{
    /** The whole reference table; the client caches it for offline lookups. */
    public function signatures()
    {
        return ScanSignatures::table();
    }

    /** What one signature reading means. */
    public function lookup(Request $request, string $value)
    {
        $number = (float) str_replace([',', '.', ' '], '', $value);
        abort_unless($number > 0, 422, 'Signature must be a positive number.');

        return [
            'signature' => $number,
            'matches' => ScanSignatures::match($number),
        ];
    }
}
