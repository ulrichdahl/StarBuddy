<?php

namespace App\Http\Controllers;

use App\Models\ResourceType;
use Illuminate\Http\Request;

class ResourceTypeController extends Controller
{
    public function index(Request $request)
    {
        return ResourceType::query()
            ->when($request->query('search'), fn ($q, $s) => $q->whereLike('name', "%{$s}%", caseSensitive: false))
            ->orderBy('name')
            ->limit(50)
            ->get();
    }
}
