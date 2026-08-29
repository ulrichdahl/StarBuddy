<?php

namespace App\Http\Controllers;

use App\Models\ItemStack;
use Illuminate\Http\Request;

class ItemStackController extends Controller
{
    public function index(Request $request)
    {
        $query = ItemStack::visibleTo($request->user())->with(['location', 'user:id,name,handle'])
            ->when($request->query('search'), fn ($q, $s) => $q->where(fn ($q) => $q
                ->whereLike('item_stacks.item_name', "%{$s}%", caseSensitive: false)
                ->orWhereLike('item_stacks.item_class', "%{$s}%", caseSensitive: false)))
            ->when($request->query('location_id'), fn ($q, $id) => $q->where('item_stacks.location_id', $id))
            ->when($request->query('system'), fn ($q, $s) => $q->whereHas('location', fn ($l) => $l->where('system', $s)))
            ->when($request->query('visibility'), fn ($q, $v) => $q->where('item_stacks.visibility', $v));
        $dir = $request->query('dir') === 'asc' ? 'asc' : 'desc';
        match ($request->query('sort')) {
            'item' => $query->orderByRaw('coalesce(item_name, item_class) '.$dir),
            'location' => $query->select('item_stacks.*')
                ->join('locations', 'locations.id', '=', 'item_stacks.location_id')
                ->orderBy('locations.name', $dir),
            'system' => $query->select('item_stacks.*')
                ->join('locations', 'locations.id', '=', 'item_stacks.location_id')
                ->orderBy('locations.system', $dir)->orderBy('locations.name', $dir),
            'quantity', 'visibility' => $query->orderBy('item_stacks.'.$request->query('sort'), $dir),
            default => $query->orderBy('item_stacks.updated_at', $dir),
        };

        return $query->paginate($this->perPage($request))->appends($request->query());
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
