// Mirrors public.fleet_can() in the database so the screens can hide what a role may not do.
// The database remains the only enforcement: this file never grants anything.
export type Role = 'tenant_admin' | 'fleet_manager' | 'property_manager' | 'finance_officer' | 'site_manager' | 'driver' | 'auditor'
export type Area = 'fleet' | 'finance' | 'property' | 'people'
export type PlatformRole = 'platform_admin' | 'platform_support'

export const ROLE_LABEL: Record<Role, string> = {
  tenant_admin: 'Organisation administrator',
  fleet_manager: 'Fleet manager',
  property_manager: 'Property manager',
  finance_officer: 'Finance officer',
  site_manager: 'Site manager',
  driver: 'Driver / requester',
  auditor: 'Auditor (read only)',
}
export const ROLES = Object.keys(ROLE_LABEL) as Role[]

export interface Membership {
  member_id: string; tenant_id: string; tenant_name: string; tenant_kind: 'government' | 'company'
  role: Role; unit_id: string | null; unit_name: string | null
}
export interface Who { platform_role: PlatformRole | null; memberships: Membership[] }

export function can(role: Role | null | undefined, area: Area, write: boolean): boolean {
  switch (role) {
    case 'tenant_admin': return true
    case 'fleet_manager': return area === 'fleet' || (!write && (area === 'finance' || area === 'property'))
    case 'property_manager': return area === 'property' || (!write && (area === 'fleet' || area === 'finance'))
    case 'finance_officer': return area === 'finance' || (!write && (area === 'fleet' || area === 'property'))
    case 'site_manager': return area === 'fleet' || (!write && (area === 'finance' || area === 'property'))
    case 'auditor': return !write
    default: return false
  }
}
