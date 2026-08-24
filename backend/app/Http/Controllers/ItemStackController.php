<?php

namespace App\Http\Controllers;

use App\Models\ItemStack;
use Illuminate\Http\Request;

class ItemStackController extends Controller
{
    public function index(Request $request)
    {
        return ItemStack::visibleTo($request->user())
            ->with(['location', 'user:id,name,handle'])
            ->latest('updated_at')
            ->paginate(50);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'item_class' => ['required', 'string', 'max:255'],
            'item_name' => ['nullable', 'string', 'max:255'],
            'location_id' => ['required', 'exists:locations,id'],
            'quantity' => ['required', 'integer', 'min:1'],
            'visibility' => ['sometimes', 'in:private,org'],
            'org_id' => ['nullable', 'exists:orgs,id'],
        ]);

        $data['user_id'] = $request->user()->id;
        $data['org_id'] ??= $request->user()->orgs()->value('orgs.id');

        return ItemStack::create($data)->load('location');
    }

    public function update(Request $request, ItemStack $itemStack)
    {
        abort_unless($itemStack->user_id === $request->user()->id, 403);

        $data = $request->validate([
            'quantity' => ['sometimes', 'integer', 'min:0'],
            'location_id' => ['sometimes', 'exists:locations,id'],
            'visibility' => ['sometimes', 'in:private,org'],
        ]);

        $itemStack->update($data);

        if ($itemStack->quantity === 0) {
            $itemStack->delete();
            return response()->noContent();
        }

        return $itemStack->load('location');
    }

    public function destroy(Request $request, ItemStack $itemStack)
    {
        abort_unless($itemStack->user_id === $request->user()->id, 403);
        $itemStack->delete();

        return response()->noContent();
    }
}
