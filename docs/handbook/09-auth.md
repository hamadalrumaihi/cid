# Chapter 9 — Authentication & Permissions

[← Handbook index](README.md)

## Login flow (who are you?)

```
   visitor                 Supabase Auth              this app
      │  click Discord/Google  │                          │
      ├───────────────────────►│  OAuth redirect          │
      │◄───────────────────────┤                          │
      │  land on "/" with tokens                          │
      ├──────────────────────────────────────────────────►│ page.tsx WAITS for
      │                        │◄─────────────────────────┤ the auth event, then
      │                        │  session (JWT) stored    │ redirects to a tab
      │                        │                          │
      │            auth.tsx evaluate(): fetch profiles row│
      │  state = 'in' (active) │ 'pending' (not approved) │ 'error' (retry)
```

- Three ways in: Discord OAuth, Google OAuth, emailed magic link. No
  passwords stored.
- The **session** is a signed JWT the client library attaches to every
  request and auto-refreshes hourly.
- First sign-in: a database trigger creates a `profiles` row with
  `active=false`. The UI shows "not yet approved"; **every** RLS check
  fails until Command activates the profile (Roster screen →
  `assign_member` RPC).
- `AuthProvider` (`lib/auth.tsx`) exposes the state machine
  (`loading|setup|out|pending|error|in`) via `useAuth()`; a sequence
  guard keeps bursty auth events from applying stale results.

## Roles

`detective` → `senior_detective` → `bureau_lead` → `deputy_director` →
`director`. **Command staff** = bureau_lead (within their bureau) +
deputy_director + director (global). Plus a bureau:
`LSB | BCB | SAB | JTF` — JTF is a **temporary joint-case designation**
(and the pre-approval profile default), never a permanent home. One
canonical definition: `src/lib/roles.ts` (the client mirror of the server
matrix `private.can_assign_cid_role`).

**Unified assignment matrix (v1.16)** — who may grant a role (signup
approval, promotion/demotion, transfer role changes all use the same rule):

| Final role | May approve / assign |
|---|---|
| Detective / Senior Detective | Bureau Lead of that bureau, or higher |
| Bureau Lead | Deputy Director, Director, or Owner |
| Deputy Director | Director or Owner |
| Director | Owner |

No self-approval, self-role-change, or self-transfer anywhere. Every
approval-with-changes, promotion, demotion, and transfer records a reason.
`profiles.role/division/active/is_owner/removed_at` are frozen against ALL
direct client writes (non-definer trigger) — the audited RPCs are the only
mutation path, and each writes `role_events` (+`reason`/`source`/`source_id`).
Department moves are a two-sided workflow: source Bureau Lead → target
Bureau Lead → completed, with Deputy Director+ able to complete directly
(`transfer_requests`, [Ch. 7](07-api.md)). Justice roles (ADA/DA/AG/Judge)
are a separate identity domain and grant no CID assignment authority.

## Permissions (what may you do?) — three layers

```
Layer 1  UI hints        canEdit / canDelete / isCommand   → hides buttons only
Layer 2  RLS policies    private.* helpers on all 47 tables → the real wall
Layer 3  Guard triggers  column-level locks                 → even allowed writers
                                                              can't touch protected
                                                              columns directly
```

- **Layer 1** comes from `useAuth()`: `canEdit` = active member;
  `canDelete`/`isCommand` = active + command role. Cosmetic only.
- **Layer 2**: every table's policies delegate to `private.is_active()`,
  `can_access_case()`, `can_delete()`, etc. ([Ch. 8](08-database.md)).
  Patterns: shared-intel / case-scoped / own-row / system.
- **Layer 3**: `guard_profile` (no self-promotion),
  `block_direct_signoff`, `block_direct_report_finalize`,
  `block_tracker_self_cosign`.

**Why**: the anon key ships in the JavaScript bundle — anyone can read it.
That is safe only because the key grants nothing; every row crosses RLS.
Client-side "security" would be theater.

## Route protection

There is none server-side — every route serves the same static shell.
Protection = `Gate` blocks the UI when signed out + RLS returns zero rows
to anyone who bypasses the UI. This is why pre-rendering all routes is
safe.

## The traps

- A write blocked by RLS does **not** throw — it returns `{error}` or
  zero rows. Always surface it ([Ch. 13](13-debugging.md)).
- Members cannot select `profiles.email` (command column grant) — use
  `PROFILE_COLS` / `updateNoSelect`.
- UI mirrors of server rules exist in `useNavBadges.canReviewCase` and
  `Subtabs` (audit owner) — keep them matching the SQL or users see
  phantom badges/tabs.
