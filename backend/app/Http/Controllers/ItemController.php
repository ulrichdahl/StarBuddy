<?php

namespace App\Http\Controllers;

use App\Models\Item;
use Illuminate\Http\Request;

class ItemController extends Controller
{
    /**
     * Autocomplete over the item catalog: names (or class names) containing
     * the search term, prefix matches first, then alphabetical. Capped —
     * it feeds a dropdown, not a table.
     */
    public function index(Request $request)
    {
        $search = trim((string) $request->query('search', ''));
        $limit = min(50, max(1, (int) $request->query('limit', 25)));

        return Item::query()
            ->when($search !== '', function ($q) use ($search) {
                $q->where(fn ($q) => $q
                    ->whereLike('name', "%{$search}%", caseSensitive: false)
                    ->orWhereLike('class_name', "%{$search}%", caseSensitive: false))
                    ->orderByRaw('CASE WHEN lower(name) LIKE ? THEN 0 ELSE 1 END', [mb_strtolower($search).'%']);
            })
            ->orderBy('name')
            ->limit($limit)
            ->get(['id', 'uuid', 'name', 'class_name', 'type', 'type_label', 'sub_type_label', 'manufacturer', 'size', 'grade']);
    }
}
