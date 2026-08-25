/** Entities exposed by the StarBuddy Laravel API. */

export interface Org {
  id: number
  name: string
  tag?: string
}

/** Authenticated member, from GET /api/me. */
export interface Me {
  id: number
  // Star Citizen handle — null until the member sets it.
  handle: string | null
  discord_username: string
  avatar_url: string | null
  // UI language ('en' | 'da'); null until first login stores the browser's.
  locale: string | null
  orgs: Org[]
}

export type OrgRole = 'member' | 'manager' | 'officer' | 'admin'

export type OrgMembershipStatus = 'pending' | 'active'

/** The caller's own membership in an org; null when not a member. */
export interface OrgMembership {
  role: OrgRole
  status: OrgMembershipStatus
}

/** One org with pooled stats, from GET /api/orgs. */
export interface OrgSummary {
  id: number
  name: string
  member_count: number
  total_scu: number
  total_pieces: number
  blueprint_count: number
  membership: OrgMembership | null
}

/** One member row, from GET /api/orgs/{id}/members (managers only). */
export interface OrgMember {
  id: number
  name: string
  handle: string | null
  avatar_url: string | null
  role: OrgRole
  status: OrgMembershipStatus
}

export interface DashboardStats {
  total_resources_scu: number
  blueprint_count: number
  open_refinery_orders: number
}

export type ResourceUnit = 'scu' | 'pieces'

export interface ResourceType {
  id: number
  name: string
  category: string
  unit: ResourceUnit
  /** Qualities commonly seen for this resource, used for quick-pick chips. */
  known_qualities?: number[]
  /** Derived from spawn probabilities: common … legendary. */
  rarity?: string | null
}

export interface Location {
  id: number
  name: string
  // Star system for grouping; null on personal locations (ships, bases).
  system?: string | null
  kind?: string
}

export type Visibility = 'private' | 'org'

export interface ResourceStack {
  id: number
  resource_type: Pick<ResourceType, 'name' | 'category' | 'unit' | 'rarity'>
  quality: number | null
  /** Quantity in milli-SCU (1 crate = 1 mSCU = 0.001 SCU). */
  quantity_mscu: number | null
  quantity_pieces: number | null
  location: Location
  visibility: Visibility
  updated_at: string
}

export interface CreateResourceStack {
  resource_type_id: number
  quality: number | null
  quantity_mscu?: number
  quantity_pieces?: number
  location_id: number
  visibility: Visibility
}

export interface ItemStack {
  id: number
  user_id: number
  item_class: string
  item_name: string | null
  quantity: number
  location: Location
  visibility: Visibility
  source: string
  // Links a crafted stack to its craft.completed audit row — undoable.
  craft_id: number | null
  updated_at: string
}

export interface CreateItemStack {
  item_class: string
  quantity: number
  location_id: number
  visibility: Visibility
}

export interface Blueprint {
  id: number
  name: string
  category?: string
}

export interface OwnedBlueprint {
  id: number
  // Raw (possibly pack-localized) name from the log or manual entry.
  blueprint_name: string
  // Canonical item class resolved by the desktop client; null if unresolved.
  item_class: string | null
  // Linked recipe-DB entry once resolved server-side; null until then.
  blueprint: Blueprint | null
  user?: { id: number; name: string; handle: string | null }
  acquired_at?: string | null
  source: string
}

export interface RefineryOrder {
  id: number
  station: string
  method: string | null
  materials: unknown[] | null
  placed_at: string | null
  eta: string | null
  completed_at: string | null
  source: string
}

/** One parsed CSV line from POST /api/import/resources/preview. */
export interface ImportPreviewRow {
  line: number
  data: Record<string, string>
  errors: string[]
}

export interface ImportPreview {
  rows: ImportPreviewRow[]
  valid_count: number
  error_count: number
  token: string
}

/** Body for DELETE /api/admin/inventory. */
export interface BulkClearRequest {
  resource_type_id?: number
  category?: string
  member_id?: number
  location_id?: number
}

/** One row of GET /api/blueprints/matrix: a blueprint and which members own it. */
export interface BlueprintMatrixRow {
  blueprint_id: number
  name: string
  type_display: string | null
  owner_ids: number[]
}

/** Active org-mate (incl. the viewer) — one column in the blueprint matrix. */
export interface BlueprintMatrixMember {
  id: number
  handle: string
}

/** Laravel paginator envelope plus a top-level `members` list. */
export interface BlueprintMatrixResponse {
  data: BlueprintMatrixRow[]
  members: BlueprintMatrixMember[]
  current_page: number
  last_page: number
  per_page: number
  total: number
}
