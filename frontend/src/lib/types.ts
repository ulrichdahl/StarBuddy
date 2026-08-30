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
  user_id: number
  /** Owner (id, name, handle) — org-visible stacks of org mates are listed too. */
  user: { id: number; name: string | null; handle: string | null } | null
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
  /** Display name from the catalog; null for a free-typed class. */
  item_name?: string | null
  quantity: number
  location_id: number
  visibility: Visibility
}

/** Game item from the synced wiki catalog (`/api/items`). All fields are game data, shown verbatim. */
export interface Item {
  id: number
  uuid: string
  name: string
  class_name: string | null
  type: string | null
  type_label: string | null
  sub_type_label: string | null
  manufacturer: string | null
  size: number | null
  grade: string | null
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
  org_id?: number
  // Patch reset: every material stack of every org member (private included).
  everything?: boolean
  // With `everything`: only these resource categories (omit = all).
  resource_categories?: string[]
  // With `everything`: also remove item stacks (crafted items etc.).
  items?: boolean
  resource_type_id?: number
  category?: string
  member_id?: number
  location_id?: number
  // Also clear members' private stashes (implied by `everything`).
  include_private?: boolean
}

export interface BulkClearResult {
  cleared: { resource_stacks: number; item_stacks: number }
}

/** One row of GET /api/blueprints/catalog: a blueprint in kiosk order and who owns it. */
export interface CatalogRow {
  id: number
  name: string
  /** Fabrication-kiosk category / subcategory keys ("armor", "helmets"). */
  category: string
  subcategory: string
  category_label: string
  type_display: string | null
  grade: string | null
  /** Ship components and vehicle weapons only. */
  size: number | null
  is_default: boolean
  owned_by_me: boolean
  my_owned_id: number | null
  owner_ids: number[]
  /** Org members besides the viewer who own it. */
  owner_count: number
  owners: string[]
}

/** GET /api/blueprints/{id}: what a blueprint is, for the info dialog. */
export interface BlueprintInfo {
  blueprint: {
    id: number
    name: string
    item_class: string | null
    type: string | null
    sub_type: string | null
    grade: string | null
    craft_time_seconds: number | null
    is_default: boolean
    description: string | null
    image_url: string | null
    manufacturer: string | null
    type_display: string | null
    game_version: string | null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    item_meta: { mass?: number; size?: number; stats?: Record<string, any> } | null
  }
  category_label: string
  owned_by_me: boolean
  owners: { id: number; handle: string; mine: boolean }[]
  /** Community approximation of how far crafting quality moves quality-scaling stats. */
  quality_range: { min_percent: number; max_percent: number }
  /** Missions that award the blueprint — filled in later. */
  missions: unknown[]
}

export interface CatalogCategory {
  key: string
  label: string
  subs: { key: string; label: string }[]
}

/** Laravel paginator envelope plus the org members (matrix columns) and the kiosk categories. */
export interface CatalogResponse {
  data: CatalogRow[]
  total: number
  per_page: number
  current_page: number
  last_page: number
  members: { id: number; handle: string }[]
  categories: CatalogCategory[]
}

// ── RSI service status (mirrored from status.robertsspaceindustries.com) ──

export type StatusSeverity = 'maintenance' | 'disrupted' | 'down' | 'notice' | string

export interface StatusIncident {
  id: number
  slug: string
  title: string
  severity: StatusSeverity
  resolved: boolean
  informational: boolean
  affected: string[]
  body_html: string | null
  // Plain text with **bold** markers, paragraphs separated by blank lines.
  body_text: string
  // Announced server shutdown, when the notice states one.
  shutdown_at: string | null
  permalink: string | null
  started_at: string | null
  updated_at: string | null
  resolved_at: string | null
  // Changes whenever RSI edits the notice — drives "new alert" detection.
  version: string | null
}

export interface RsiStatus {
  summary: string
  systems: { name: string; status: string }[]
  fetched_at: string | null
  status_url: string
  active: StatusIncident[]
  recent: StatusIncident[]
}

/** One org member as a column in the Org matrix views. */
export interface MatrixMember {
  id: number
  handle: string
}

/** What one member holds of a grouped row. */
export interface OrgHolding {
  quantity: number
  stacks: number
}

interface OrgRowBase {
  key: string
  total: number
  stacks: number
  holder_count: number
  /** Keyed by user id (JSON object keys are strings). */
  holders: Record<string, OrgHolding>
}

/** `/api/org/items`: org-visible item stacks grouped per item class. */
export interface OrgItemRow extends OrgRowBase {
  name: string
  item_class: string
}

/** `/api/org/materials`: org-visible resource stacks grouped per material + quality. */
export interface OrgMaterialRow extends OrgRowBase {
  resource_type: Pick<ResourceType, 'id' | 'name' | 'category' | 'unit' | 'rarity'> | null
  quality: number
}

export interface OrgInventoryExtra {
  members: MatrixMember[]
}
