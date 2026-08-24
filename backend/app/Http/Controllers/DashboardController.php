<?php

namespace App\Http\Controllers;

use App\Models\BlueprintOwned;
use App\Models\RefineryOrder;
use App\Models\ResourceStack;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    public function __invoke(Request $request)
    {
        $user = $request->user();

        $visible = ResourceStack::visibleTo($user)
            ->join('resource_types', 'resource_types.id', '=', 'resource_stacks.resource_type_id');

        return [
            'total_mscu' => (int) (clone $visible)->where('resource_types.unit', 'mscu')->sum('quantity'),
            'total_pieces' => (int) (clone $visible)->where('resource_types.unit', 'pieces')->sum('quantity'),
            'stack_count' => ResourceStack::visibleTo($user)->count(),
            'blueprint_count' => BlueprintOwned::where('user_id', $user->id)->count(),
            'open_refinery_orders' => RefineryOrder::where('user_id', $user->id)->whereNull('completed_at')->count(),
        ];
    }
}
