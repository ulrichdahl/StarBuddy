<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\ItemStack;
use App\Models\Org;
use App\Models\ResourceStack;
use Illuminate\Http\Request;

/**
 * P1.1 — bulk clear of org inventory by resource type or category,
 * optionally scoped to a member or location, or everything at once after
 * a game wipe. Officer/manager/admin only. What was cleared, and by whom,
 * always lands in the audit log.
 */
class AdminInventoryController extends Controller
{
    public function clear(Request $request)
    {
        $data = $request->validate([
            'org_id' => ['nullable', 'exists:orgs,id'],
            // Patch reset: every material stack of every org member (optionally
            // only some categories — long-term persistence keeps a moving
            // subset from patch to patch) and, if asked, item stacks too.
            'everything' => ['nullable', 'boolean'],
            'resource_categories' => ['nullable', 'array'],
            'resource_categories.*' => ['string'],
            'items' => ['nullable', 'boolean'],
            'resource_type_id' => ['nullable', 'exists:resource_types,id'],
            'category' => ['nullable', 'string'],
            'item_class' => ['nullable', 'string'],
            'member_id' => ['nullable', 'exists:users,id'],
            'location_id' => ['nullable', 'exists:locations,id'],
            // Members' private stashes are left alone unless asked for
            // (a game wipe takes them too — the game did).
            'include_private' => ['nullable', 'boolean'],
        ]);

        $everything = (bool) ($data['everything'] ?? false);
        $wipeCategories = $data['resource_categories'] ?? null;   // null = all
        $wipeItems = (bool) ($data['items'] ?? true);
        $typeId = $data['resource_type_id'] ?? null;
        $category = $data['category'] ?? null;
        $itemClass = $data['item_class'] ?? null;
        $memberId = $data['member_id'] ?? null;
        $locationId = $data['location_id'] ?? null;
        $includePrivate = $everything || (bool) ($data['include_private'] ?? false);

        if (! $everything && ! $typeId && ! $category && ! $itemClass) {
            return response()->json([
                'message' => 'Specify a resource type, a category or an item class — or choose "everything" for a game wipe.',
            ], 422);
        }

        $org = isset($data['org_id'])
            ? Org::findOrFail($data['org_id'])
            : $request->user()->orgs()->firstOrFail();
        abort_unless($request->user()->isOrgOfficer($org), 403, 'Only org officers can bulk-clear inventory.');

        $memberIds = $org->members()->pluck('users.id');
        $scope = fn ($q) => $q->whereIn('user_id', $memberIds)
            ->when(! $includePrivate, fn ($q) => $q->where('visibility', 'org'))
            ->when($memberId, fn ($q, $id) => $q->where('user_id', $id))
            ->when($locationId, fn ($q, $id) => $q->where('location_id', $id));

        $cleared = ['resource_stacks' => 0, 'item_stacks' => 0];

        if (($everything && $wipeCategories !== []) || $typeId || $category) {
            $query = $scope(ResourceStack::query())
                ->when($typeId, fn ($q, $id) => $q->where('resource_type_id', $id))
                ->when($category, fn ($q, $c) => $q->whereHas('resourceType', fn ($t) => $t->where('category', $c)))
                ->when($everything && $wipeCategories !== null, fn ($q) => $q->whereHas('resourceType', fn ($t) => $t->whereIn('category', $wipeCategories)));
            $cleared['resource_stacks'] = $query->count();
            $query->delete();
        }

        if (($everything && $wipeItems) || $itemClass) {
            $query = $scope(ItemStack::query())
                ->when($itemClass, fn ($q, $c) => $q->where('item_class', $c));
            $cleared['item_stacks'] = $query->count();
            $query->delete();
        }

        AuditLog::create([
            'user_id' => $request->user()->id,
            'org_id' => $org->id,
            'action' => $everything ? 'inventory.wipe' : 'inventory.bulk_clear',
            'details' => [...$data, 'cleared' => $cleared],
        ]);

        return ['cleared' => $cleared];
    }
}
