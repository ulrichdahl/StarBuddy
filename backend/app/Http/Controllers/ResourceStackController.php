<?php

namespace App\Http\Controllers;

use App\Models\ResourceStack;
use App\Models\ResourceType;
use Illuminate\Http\Request;

class ResourceStackController extends Controller
{
    public function index(Request $request)
    {
        $query = ResourceStack::visibleTo($request->user())
            ->with(['resourceType', 'location', 'user:id,name,handle'])
            ->when($request->query('search'), fn ($q, $s) => $q->whereHas(
                'resourceType', fn ($t) => $t->whereLike('name', "%{$s}%", caseSensitive: false),
            ))
            ->when($request->query('quality_min'), fn ($q, $v) => $q->where('resource_stacks.quality', '>=', (int) $v))
            ->when($request->query('quality_max'), fn ($q, $v) => $q->where('resource_stacks.quality', '<=', (int) $v))
            ->when($request->query('location_id'), fn ($q, $v) => $q->where('resource_stacks.location_id', (int) $v))
            ->when($request->query('system'), fn ($q, $s) => $q->whereHas('location', fn ($l) => $l->where('system', $s)))
            ->when($request->query('visibility'), fn ($q, $v) => $q->where('resource_stacks.visibility', $v));

        $dir = $request->query('dir') === 'asc' ? 'asc' : 'desc';
        match ($request->query('sort')) {
            'resource' => $query->select('resource_stacks.*')
                ->join('resource_types', 'resource_types.id', '=', 'resource_stacks.resource_type_id')
                ->orderBy('resource_types.name', $dir),
            'location' => $query->select('resource_stacks.*')
                ->join('locations', 'locations.id', '=', 'resource_stacks.location_id')
                ->orderBy('locations.name', $dir),
            'system' => $query->select('resource_stacks.*')
                ->join('locations', 'locations.id', '=', 'resource_stacks.location_id')
                ->orderBy('locations.system', $dir)->orderBy('locations.name', $dir),
            'quality', 'quantity', 'visibility' => $query->orderBy('resource_stacks.'.$request->query('sort'), $dir),
            default => $query->orderBy('resource_stacks.updated_at', $dir),
        };

        return $query->paginate($this->perPage($request))->appends($request->query());
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
            'quantity_mscu' => ['sometimes', 'integer', 'min:0'],
            'quantity_pieces' => ['sometimes', 'integer', 'min:0'],
            'location_id' => ['sometimes', 'exists:locations,id'],
            'visibility' => ['sometimes', 'in:private,org'],
        ]);

        $data['quantity'] = $data['quantity'] ?? $data['quantity_mscu'] ?? $data['quantity_pieces'] ?? null;
        if ($data['quantity'] === null) {
            unset($data['quantity']);
        }
        unset($data['quantity_mscu'], $data['quantity_pieces']);

        if (isset($data['quality'])) {
            $resourceStack->resourceType->learnQuality($data['quality']);
        }
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
