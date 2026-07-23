/** Phase 5 MDT bridge expansion — configuration gate.
 *
 *  The expanded MDT surface (arrest-warrant / record / account export kinds,
 *  the account CID-only lane, expiry reminders, lane badges) is INERT unless
 *  NEXT_PUBLIC_MDT_EXPANSION is explicitly set to 'on': no new options render,
 *  no new queries run, and the propose payload stays byte-identical to the
 *  pre-expansion one — the live panel renders exactly what it renders today.
 *  Server-side the bridge is equally dormant (mdt_patrol_feed is
 *  service_role-only). See docs/MDT-BRIDGE-CONTRACT.md. */
export const isMdtExpansionConfigured = (): boolean =>
  process.env.NEXT_PUBLIC_MDT_EXPANSION === 'on'
