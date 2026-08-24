<?php

namespace App\Http\Controllers;

use App\Models\ResourceStack;
use App\Models\ResourceType;
use Illuminate\Http\Request;

class ResourceStackController extends Controller
{
    public function index(Request $request)
    {
        return ResourceStack::visibleTo($request->user())
            ->with(['resourceType', 'location', 'user:id,name,handle'])
            ->latest('updated_at')
            ->paginate(50);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'resource_type_id' => ['required', 'exists:resource_types,id'],
            'location_id' => ['required', 'exists:locations,id'],
            'quality' => ['required', 'integer', 'min:0', 'max:1000'],
            'quantity' => ['required_without_all:quantity_mscu,quantity_pieces', 'integer', 'min:1'],
            'quantity_mscu' => ['nullable', 'integer', 'min:1'],
            'quantity_pieces' => ['nullable', 'integer', 'min:1'],
            'visibility' => ['sometimes', 'in:private,org'],
            'org_id' => ['nullable', 'exists:orgs,id'],
        ]);

        $data['quantity'] ??= $data['quantity_mscu'] ?? $data['quantity_pieces'];
        unset($data['quantity_mscu'], $data['quantity_pieces']);
        $data['user_id'] = $request->user()->id;
        $data['updated_by'] = $request->user()->id;
        $data['org_id'] ??= $request->user()->orgs()->value('orgs.id');

        $stack = ResourceStack::create($data);

        ResourceType::find($data['resource_type_id'])->learnQuality($data['quality']);

        return $stack->load(['resourceType', 'location']);
    }

    public function update(Request $request, ResourceStack $resourceStack)
    {
        abort_unless($resourceStack->user_id === $request->user()->id, 403);

        $data = $request->validate([
            'quality' => ['sometimes', 'integer', 'min:0', 'max:1000'],
            'quantity' => ['sometimes', 'integer', 'min:0'],
            'location_id' => ['sometimes', 'exists:locations,id'],
            'visibility' => ['sometimes', 'in:private,org'],
        ]);

        $data['updated_by'] = $request->user()->id;
        $resourceStack->update($data);

        // A stack consumed down to zero disappears from the ledger.
        if ($resourceStack->quantity === 0) {
            $resourceStack->delete();
            return response()->noContent();
        }

        return $resourceStack->load(['resourceType', 'location']);
    }

    public function destroy(Request $request, ResourceStack $resourceStack)
    {
        abort_unless($resourceStack->user_id === $request->user()->id, 403);
        $resourceStack->delete();

        return response()->noContent();
    }
}
