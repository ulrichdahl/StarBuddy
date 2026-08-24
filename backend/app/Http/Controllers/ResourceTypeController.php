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
            ->when($request->query('categories'), fn ($q, $c) => $q->whereIn('category', explode(',', $c)))
            ->orderBy('category')
            ->orderBy('name')
            ->limit(100)
            ->get();
    }
}
