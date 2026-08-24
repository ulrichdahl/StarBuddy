<?php

namespace App\Http\Controllers;

use App\Models\RefineryOrder;
use Illuminate\Http\Request;

class RefineryOrderController extends Controller
{
    public function index(Request $request)
    {
        return RefineryOrder::where('user_id', $request->user()->id)
            ->latest('placed_at')
            ->paginate(50);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'station' => ['required', 'string', 'max:255'],
            'method' => ['nullable', 'string', 'max:255'],
            'materials' => ['nullable', 'array'],
            'placed_at' => ['nullable', 'date'],
            'eta' => ['nullable', 'date'],
        ]);

        $data['user_id'] = $request->user()->id;

        return RefineryOrder::create($data);
    }
}
