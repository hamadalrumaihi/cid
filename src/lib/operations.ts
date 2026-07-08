'use client'

/** Operations / Task Forces cache — vanilla operations.js:8-25. Shared by the
 *  Operations view, the case modal's operation picker and the case-hero chip. */
import { create } from 'zustand'
import { list } from './db'
import type { Tables } from './database.types'

export type OperationRow = Tables<'operations'>

/** Slim case rows for rollups + linking (projection, not full rows). */
export interface OpsCaseRow {
  id: string
  case_number: string | null
  title: string | null
  status: string | null
  bureau: string | null
  operation_id: string | null
  lead_detective_id: string | null
  updated_at: string
}

export const OPS_CASE_COLS = 'id,case_number,title,status,bureau,operation_id,lead_detective_id,updated_at'

interface OperationsState {
  operations: OperationRow[]
  loaded: boolean
  fetch: () => Promise<OperationRow[]>
}

export const useOperationsStore = create<OperationsState>((set) => ({
  operations: [],
  loaded: false,
  async fetch() {
    try {
      const rows = await list('operations', { order: 'created_at', ascending: false })
      set({ operations: rows, loaded: true })
      return rows
    } catch {
      set({ loaded: true })
      return []
    }
  },
}))

export const OP_STATUSES = ['open', 'active', 'cold', 'closed'] as const
export const OP_SEG_COLOR: Record<string, string> = { open: 'bg-amber-400', active: 'bg-emerald-400', cold: 'bg-blue-400', closed: 'bg-slate-500' }
export const opStatusTint = (s?: string | null): string =>
  s === 'closed' ? 'bg-slate-500/20 text-slate-300' : 'bg-emerald-500/15 text-emerald-300'
