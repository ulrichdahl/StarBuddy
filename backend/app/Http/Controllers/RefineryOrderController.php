<?php

namespace App\Http\Controllers;

use App\Models\RefineryOrder;
use Illuminate\Http\Request;

class RefineryOrderController extends Controller
{
    public function index(Request $request)
    {
        $dir = $request->query('dir') === 'asc' ? 'asc' : 'desc';
        $sort = $request->query('sort');
        $column = in_array($sort, ['station', 'method', 'completed_at', 'eta', 'source'], true) ? $sort : 'placed_at';

        return RefineryOrder::where('user_id', $request->user()->id)
            ->orderBy($column, $dir)
            ->paginate($this->perPage($request))
            ->appends($request->query());
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
