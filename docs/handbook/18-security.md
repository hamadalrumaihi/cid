# Chapter 18 — Security Notes

[← Handbook index](README.md)

## The model, one line

**Anon key public → RLS is the wall → SECURITY DEFINER RPCs are the
doors → guard triggers are the locks on specific columns.**

## Verified strong (July 2026 audit)

- RLS on all 47 tables; deny-all `app_secrets`; owner-only `audit_log`.
- Anonymous EXECUTE revoked on all RPCs (ACLs verified:
  authenticated + service_role only).
- No secrets in the repo — committed keys (Supabase anon, FiveManage) are
  public-by-design; `service_role` exists only in Supabase's dashboard.
- XSS: React auto-escaping; ONE sanctioned static
  `dangerouslySetInnerHTML` (the pref applier); `safeUrl` on DB-sourced
  links (unit-tested); the markdown renderer builds elements, never HTML.
- CSV exports formula-injection-guarded (unit-tested).
- CSP: `default-src 'self'`, exact connect-src allow-list,
  `frame-ancestors 'none'`; `wasm-unsafe-eval` (not full eval) for PDFs.
- Authorship unforgeable (stamp triggers + `create_notification`);
  self-promotion and self-co-sign trigger-blocked.

## Residual risks / accepted trade-offs

1. **RPC internals are the escalation surface** — `assign_member` etc.
   check the caller inside; a bug there = privilege escalation. Review
   any RPC edit line-by-line.
2. `mo_crossref` deliberately leaks case *existence* across bureaus (with
   request-access flow) — design, not defect.
3. UI mirrors of server rules (`canReviewCase`, audit-owner tab) can
   mislead if they drift — server still refuses, but keep them synced.
4. Rate limiting = Supabase platform defaults; no app-level throttle
   (accepted at this scale).
5. `bootstrap_command`/`bootstrap_director` RPCs remain from setup —
   drop or verify inert ([Ch. 19](19-improvements.md)).
6. Dashboard-only settings (OTP expiry 30 min, leaked-password
   protection, backups) are the owner's checklist — status in
   `docs/HARDENING.md`.

## Rules for contributors

Never weaken `safeUrl`/`humanizeError`/`csvCell`; never bypass `db.ts`;
never add an external host without updating the CSP *and* thinking about
what it can exfiltrate; treat any SECURITY DEFINER change as a security
review, not a code review.
