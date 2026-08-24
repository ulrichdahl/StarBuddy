/** Entities exposed by the StarMaker Laravel API. */

export interface Org {
  id: number
  name: string
  tag?: string
}

/** Authenticated member, from GET /api/me. */
export interface Me {
  id: number
  handle: string
  discord_username: string
  avatar_url: string | null
  orgs: Org[]
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
}

export interface Location {
  id: number
  name: string
}

export type Visibility = 'private' | 'org'

export interface ResourceStack {
  id: number
  resource_type: Pick<ResourceType, 'name' | 'category' | 'unit'>
  quality: number | null
  /** Quantity in milli-SCU (1 crate = 1 mSCU = 0.001 SCU). */
  quantity_mscu: number | null
  quantity_pieces: number | null
  location: Pick<Location, 'name'>
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
  item_class: string
  quantity: number
  location: Pick<Location, 'name'>
  visibility: Visibility
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
  blueprint: Blueprint
  owner?: { handle: string }
  acquired_at?: string
}

export interface RefineryOrder {
  id: number
  refinery: string
  method: string
  status: string
  yield_scu: number
  completes_at: string | null
  owner?: { handle: string }
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
