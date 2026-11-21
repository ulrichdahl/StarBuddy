import type { Me, Org, OrgRole } from './types'

/** Roles that may run the org admin tools (bulk-clear). */
const OFFICER_ROLES: OrgRole[] = ['officer', 'manager', 'admin']

/** The orgs the player can administer, the main org first. */
export function officerOrgs(me: Me): Org[] {
  return me.orgs.filter((o) => o.pivot && OFFICER_ROLES.includes(o.pivot.role))
}

/** Whether the player may use the Admin page: an officer of their main org. */
export function canAdminister(me: Me): boolean {
  return officerOrgs(me).some((o) => o.id === me.main_org_id)
}

/** Whether a nav entry or page is open to the player. */
export function canSee(me: Me, page: string): boolean {
  if (page === 'admin') return canAdminister(me)
  if (page === 'training') return me.is_tester
  return true
}
