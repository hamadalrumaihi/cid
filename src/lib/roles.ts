import type { Database } from './database.types'

export type AppRole = Database['public']['Enums']['app_role']
export type Bureau = Database['public']['Enums']['bureau']

export const ROLE_LABEL: Record<string, string> = {
  detective: 'Detective',
  senior_detective: 'Senior Detective',
  bureau_lead: 'Bureau Lead',
  deputy_director: 'Deputy Director',
  director: 'Director',
}
export const COMMAND_ROLES = ['bureau_lead', 'deputy_director', 'director'] as const
export const SUBMIT_ROLES = ['detective', 'senior_detective'] as const
export const BUREAUS: Record<string, string> = {
  LSB: 'Los Santos Bureau',
  BCB: 'Blaine County Bureau',
  SAB: 'State Bureau',
  JTF: 'Joint Task Force',
}

export const roleLabel = (r?: string | null) => (r && ROLE_LABEL[r]) || r || '—'
export const isCommand = (r?: string | null) => !!r && (COMMAND_ROLES as readonly string[]).includes(r)
