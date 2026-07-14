# Security Review Guide

Reviewer's checklist and threat-model summary for any change touching data access. This is a human-reviewed system: the database enforces rule-based policy, and a human reviewer is the last line before a policy change ships. Drawn from [HARDENING.md](HARDENING.md) and [handbook ch. 18](handbook/18-security.md); mechanics in [RLS.md](RLS.md); who-may-do-what in [AUTHORIZATION.md](AUTHORIZATION.md).

## 1. Trust boundaries

- **The browser is untrusted.** Every route serves the same static shell; there is no server-side route protection. Anything the client sends — filters, IDs, role hints, form fields — is attacker-controlled.
- **The anon key is public by design.** It ships in the JavaScript bundle and grants nothing RLS doesn't allow. Do not treat its secrecy (or the `Origin` header) as a boundary.
- **RLS is the wall.** Every table has RLS enabled; policies key on `auth.uid()` via the `private.*` helpers. A blocked write does not throw — it returns `{error}` or zero rows.
- **UI gates are cosmetic.** `canEdit` / `canDelete` / `isCommand` only hide buttons. If a UI mirror drifts from the SQL, the server still refuses — but keep them synced so humans aren't shown phantom capabilities.
- **Every privileged action is a named human actor**, validated server-side inside a definer RPC. There is no runtime automation with authority of its own; the workflow logic is deterministic SQL executing human decisions.

The one-line model ([ch. 18](handbook/18-security.md)): **anon key public → RLS is the wall → SECURITY DEFINER RPCs are the doors → guard triggers are the locks on specific columns.**

## 2. Escalation surfaces (where review attention goes)

| Surface | Why it's the risk | Review posture |
|---|---|---|
| **Definer RPC internals** | The caller check lives *inside* the function; a bug there = privilege escalation (`assign_member`, `review_membership_request`, the legal workflow RPCs, …) | Line-by-line. Treat any `SECURITY DEFINER` edit as a security review, not a code review. Verify: caller loaded by `auth.uid()`, state validated after `for update`, revoke-then-grant present, `search_path` pinned |
| **Triggers** | The non-definer freeze triggers enumerate columns explicitly; a new privileged column is unprotected until added (`block_direct_privileged_profile`, `block_direct_login_denied`, `block_direct_report_finalize`, `block_direct_signoff`) | Adding a privileged column? Add it to the freeze trigger **in the same migration** |
| **Column grants** | Column-level grants do **not** extend to columns added later ([`20260708140000_restrict_profile_email.sql`](../supabase/migrations/20260708140000_restrict_profile_email.sql)); a new `profiles` column is invisible until granted — and a careless table-level re-grant would re-expose `email` and `internal_decision_note` | Never `grant select on table` where per-column grants exist; grant the new columns explicitly |

## 3. Review checklist — any change touching data access

- [ ] **Every new table enables RLS** and has policies (RLS on with zero policies = invisible, which is correct only for deny-all tables like `app_secrets`). Also: realtime publication membership, FK indexes, hand-updated types ([ch. 08](handbook/08-database.md) §8.7).
- [ ] **Writes are RPC-only where workflow-bound.** If rows carry state a matrix or workflow governs (membership, transfers, legal requests, sign-off, seals), there must be **no** client INSERT/UPDATE/DELETE path — no policies, or grants revoked, plus a freeze trigger for privileged columns on shared tables.
- [ ] **New/changed functions follow the definer contract** ([RLS.md](RLS.md) §6): `set search_path to ''`, `revoke all ... from public; grant execute ... to authenticated, service_role`, named-actor validation first, `select ... for update` in decision paths, and the header comment block (Purpose / Caller / Authorization / Side effects / Audit behavior / Security notes).
- [ ] **Allow AND deny tests.** Extend `tests/rls/` with both directions: the authorized human succeeds; the unauthorized caller, the inactive account, the wrong bureau, and the self-approval attempt all fail. A suite that only proves denials can't catch a broken approval path, and vice versa.
- [ ] **Sealed-data leak channels.** For anything classification-scoped, check all four side channels: **counts** (no aggregate endpoint may reveal a sealed row exists), **search** (must be `SECURITY INVOKER` so the caller's own SELECT policy filters results), **realtime** (publication events respect the SELECT policy — scope like `tr_sel` if visibility is narrower than command), **notifications** (recipient-scoped, header text only, never narrative content).
- [ ] **Fixture exclusion.** Any new notification fan-out to real staff must skip `rls-test-%@cidportal.test` actors (precedents: `membership_request_submit`, `private.transfer_notify`); any new table with fixture-authored rows must be added to `rls_test_cleanup()`.
- [ ] **Audit trail.** Privileged transitions write `audit_log` (and `role_events` with `reason`/`source` where membership is involved). If a new RPC mutates without an audit row, that's a finding (see §4).
- [ ] **No weakening of** `safeUrl` / `humanizeError` / `csvCell`; no bypassing `db.ts`; no new external host without a CSP update and an exfiltration think-through ([ch. 18](handbook/18-security.md)).

## 4. Known accepted risks

- **Fixtures are visible to command** in the roster ("RLS Test — …") until the fixture-hiding phase ships. Command members can legitimately deactivate, deny, or remove them — that authority is real and correct; the risk is operational (broken test runs), not a security hole. See the incident below.
- **`admin_remove_member` writes no audit row.** It logs neither `audit_log` nor `role_events` (and `profiles` has no `private.audit()` trigger), so a permanent removal is only observable via the profile's `removed_at`. Accepted for now; a candidate fix for the next hardening pass.
- **`mo_crossref` deliberately leaks case *existence*** across bureaus (paired with the request-access flow) — design, not defect.
- **Rate limiting** is Supabase platform defaults; no app-level throttle at this scale ([HARDENING.md](HARDENING.md) §5).
- **`bootstrap_command` / `bootstrap_director`** setup RPCs remain — verify inert or drop ([ch. 19](handbook/19-improvements.md)).
- Dashboard-only settings (OTP expiry, leaked-password protection, backups) are the owner's manual checklist ([HARDENING.md](HARDENING.md)).

## 5. Incident precedent: production command removed the test fixtures

What happened: a production command user, exercising legitimate roster authority, manually removed/denied the `rls-test-*` fixture accounts — to a human administrator they look like ordinary (odd) roster members.

- **Detection**: `audit_log` rows — `deny_member_login` stamps `LOGIN_DENIED` entries naming the human actor and each fixture target, which is exactly how the action surfaced (permanent removal itself leaves no audit row, per §4). The suites also fail their sanity check loudly instead of silently passing when fixtures are missing.
- **Restoration**: rebuilt from the documented baseline — the fixture roster table in [`tests/rls/README.md`](../tests/rls/README.md) (account emails, roles, bureaus, active states) plus the seeding procedure in [TEST-ENVIRONMENT.md](TEST-ENVIRONMENT.md); `restore_member_login` / re-activation returned the accounts to their baseline states, and `rls_test_cleanup()` guaranteed no stale test data survived.
- **Lessons encoded**: fixture state is now restorable by the suites themselves via the tightly-gated `rls_test_reset_member()` (caller AND target must be fixtures — [`20260718020000_officer_transfers.sql`](../supabase/migrations/20260718020000_officer_transfers.sql)); the fixture-hiding phase (§4) will remove the temptation; and the `RUNBOOK` note stands — the `rls-test-*` roster entries are intentional, rotate their passwords rather than removing them ([RUNBOOK.md](RUNBOOK.md)).

**Reviewer takeaway**: audit coverage is the detection layer for privileged human actions — when you touch a privileged RPC, verify it writes an audit row, because the one that didn't is the one we couldn't see.
