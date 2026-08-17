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
Department moves are single-step (`transfer_requests`,
[Ch. 7](07-api.md)): an authorized initiator — a Bureau Lead for
rank-and-file members when one side of the move is their own bureau, or
Deputy Director+/Owner for anyone — picks a destination and reason and
the move applies immediately; JTF is a valid source and destination. Justice roles (ADA/DA/AG/Judge)
are a separate identity domain and grant no CID assignment authority. (Retired
2026-07-22: justice roles are deactivated and legal-request approval is now Bureau
Lead+ (`private.is_command()`) — see [DOJ-INTEGRATION.md](../DOJ-INTEGRATION.md)
Phase-1 banner.)

### SIU — a second investigative authority

The Special Investigation Unit is a **separate authority domain**, not another
rank: a member operates as CID (`profiles.role` + `profiles.division`) *or* as
SIU (`siu_memberships.siu_role` — `special_agent` / `senior_special_agent` /
`special_agent_in_charge`, displayed as X-Ray 1). One resolver answers every
SIU question:
`private.siu_standing()` server-side, mirrored by `siuStanding()` in
`src/lib/siu.ts` and surfaced to components as `useSiu()` — never an inline
`user.role === …` check.

Visibility is deliberately **asymmetric**: SIU reads CID across every bureau
(read only — the superset `private.can_read_case` appears in SELECT policies
and nowhere else), while CID gets **nothing** on an SIU case at any rank, in
any surface, with no placeholder to reveal that a record exists.
`siu_compartmented` cases are allow-list only, with no exemption for X-1, the
Attorney General or the owner flag. Membership is appointment-only
(`siu_appoint` / `siu_remove`); there is no request queue anywhere.

**Chain of command (the unit's SOP).** Commissioner's Office → **Director of
CID** → X-Ray 1 → agents. The Director and the Attorney General hold
`oversight` standing: personnel authority plus **read** of standard `siu`
investigations, targets, intelligence and operations — via the read-only
`private.siu_case_read()`, never the write wall `siu_case_access()`. They
cannot open, assign, reclassify, author, designate, or delete anything.
`siu_restricted` and above stay closed to them, which is what keeps an
investigation *into* the Director, the AG or X-1 possible. On a CID case the
SIU-only intelligence layer remains field-agent only, because the Director is a
plausible subject of an integrity flag.

**Taking and releasing (§14/§15).** SIU command can **assume control** of a
live CID case: one flip of `cases.case_authority` takes the case and every
child row out of CID at every rank, with the case number, bureau, lead
detective and all authorship untouched, and `siu_release_control()` gives it
back. Going the other way, SIU releases a **single item** with `siu_share()` —
to the Division, to one case's members, or to one named officer. The release
carries a snapshot of the text, never a pointer, so it can never widen into the
investigation; CID reads it through `siu_released_intelligence()`, which
projects no origin at all.

**Tradecraft (Phase 3).** Sources, undercover legends, financial and
communications intelligence, and integrity reviews all ride the WRITE wall
(`private.siu_case_access`), never the read superset — oversight reads the case
file, not the tradecraft. Sources and legends narrow further to the handler and
SIU command (`private.siu_handler_access`). Exports go through one logged RPC
that always withholds source identities, legends and intercept content.

**Build-phase gate:** while `siu_settings.enabled_for_non_owner` is false,
`siu_standing()` resolves to `owner` for the Portal Owner and NULL for
everybody else, so SIU does not exist for any other account. Full model:
[AUTHORIZATION.md §4f](../AUTHORIZATION.md).

## Permissions (what may you do?) — three layers

```
Layer 1  UI hints        canEdit / canDelete / isCommand   → hides buttons only
Layer 2  RLS policies    private.* helpers on every table  → the real wall
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
