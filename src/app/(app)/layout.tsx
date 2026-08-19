'use client'

/** Route-guarded app layout: everything under (app) sits behind the auth
 *  gate. Non-'in' states render the gate screen INSTEAD of the shell — the
 *  vanilla body[data-auth] CSS gate expressed as conditional rendering.
 *  Client gating is UX only; RLS protects the data regardless. */
import { AuthProvider, useAuth } from '@/lib/auth'
import { Gate } from '@/components/auth/Gate'
import { AppShell } from '@/components/shell/AppShell'
import { FieldShell } from '@/components/field/FieldShell'
import { Toaster } from '@/components/ui/Toaster'
import { DialogHost } from '@/components/ui/dialog'

function Gated({ children }: { children: React.ReactNode }) {
  const { state } = useAuth()
  // A SAHP/BCSO/LSPD officer with no CID standing gets their own workspace, and
  // `children` — every CID route — is never rendered for them. That is a UX
  // decision, not the security boundary: RLS refuses them the data regardless,
  // proven table by table in 20260910120000_field_officers.sql.
  if (state === 'field') return <FieldShell />
  if (state !== 'in') return <Gate />
  return <AppShell>{children}</AppShell>
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Gated>{children}</Gated>
      <Toaster />
      <DialogHost />
    </AuthProvider>
  )
}
