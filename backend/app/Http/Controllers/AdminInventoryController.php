<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\ItemStack;
use App\Models\Org;
use App\Models\ResourceStack;
use Illuminate\Http\Request;

/**
 * P1.1 — bulk clear of org inventory by resource type or category,
 * optionally scoped to a member or location. Officer/admin only.
 * What was cleared, and by whom, always lands in the audit log.
 */
class AdminInventoryController extends Controller
{
    public function clear(Request $request)
    {
        $data = $request->validate([
            'org_id' => ['nullable', 'exists:orgs,id'],
            'resource_type_id' => ['nullable', 'exists:resource_types,id'],
            'category' => ['nullable', 'string'],
            'item_class' => ['nullable', 'string'],
            'member_id' => ['nullable', 'exists:users,id'],
            'location_id' => ['nullable', 'exists:locations,id'],
        ]);

        if (! $data['resource_type_id'] && ! ($data['category'] ?? null) && ! ($data['item_class'] ?? null)) {
            return response()->json([
                'message' => 'Specify a resource type, a category, or an item class — clearing everything is not supported.',
            ], 422);
        }

        $org = isset($data['org_id'])
            ? Org::findOrFail($data['org_id'])
            : $request->user()->orgs()->firstOrFail();
        abort_unless($request->user()->isOrgOfficer($org), 403, 'Only org officers can bulk-clear inventory.');

        $cleared = ['resource_stacks' => 0, 'item_stacks' => 0];

        $memberIds = $org->members()->pluck('users.id');

        if ($data['resource_type_id'] || ($data['category'] ?? null)) {
            $query = ResourceStack::whereIn('user_id', $memberIds)->where('visibility', 'org')
                ->when($data['resource_type_id'], fn ($q, $id) => $q->where('resource_type_id', $id))
                ->when($data['category'] ?? null, fn ($q, $c) => $q->whereHas(
                    'resourceType', fn ($t) => $t->where('category', $c),
                ))
                ->when($data['member_id'] ?? null, fn ($q, $id) => $q->where('user_id', $id))
                ->when($data['location_id'] ?? null, fn ($q, $id) => $q->where('location_id', $id));

            $cleared['resource_stacks'] = $query->count();
            $query->delete();
        }

        if ($data['item_class'] ?? null) {
            $query = ItemStack::whereIn('user_id', $memberIds)->where('visibility', 'org')
                ->where('item_class', $data['item_class'])
                ->when($data['member_id'] ?? null, fn ($q, $id) => $q->where('user_id', $id))
                ->when($data['location_id'] ?? null, fn ($q, $id) => $q->where('location_id', $id));

            $cleared['item_stacks'] = $query->count();
            $query->delete();
        }

        AuditLog::create([
            'user_id' => $request->user()->id,
            'org_id' => $org->id,
            'action' => 'inventory.bulk_clear',
            'details' => [...$data, 'cleared' => $cleared],
        ]);

        return ['cleared' => $cleared];
    }
}
