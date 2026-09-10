# CID Portal — Hardening Status

Status of the 14-point hardening checklist (July 2026 sweep). ✅ = enforced,
🔧 = shipped in this sweep, 🖐 = needs a one-time dashboard action by the owner.

## 1. Lock users to their own UIDs — ✅ (verified)
Every table has Row Level Security; policies key on `auth.uid()` via the
`private.*` helper functions (`is_active`, `can_edit`, `can_delete`,
`can_access_case`, command checks). The client never decides access — the
server refuses the row. 🔧 This sweep additionally revoked **anonymous**
execute on five `SECURITY DEFINER` RPCs (`admin_member_emails`,
`admin_remove_member`, `admin_restore_member`, `create_notification`,
`stamp_author_identity`) that were callable before sign-in, and dropped the
unused `pg_net` extension (leftover from the removed Discord feed).

## 2. Expire password-reset links within 30 minutes — 🖐 dashboard
The portal signs in via magic link / OAuth (no passwords), so "reset link"
here means the email OTP / magic link. Supabase defaults to 1 hour. To make
it 30 minutes: **Supabase Dashboard → Authentication → Sign In / Up → Email →
OTP expiry → `1800` seconds.** While there, also enable **Leaked password
protection** (flagged by the security advisor; relevant if password sign-in
is ever enabled).

## 3. Sanitize all input fields — ✅ (verified)
React auto-escapes all rendered text; `dangerouslySetInnerHTML` appears once
in the codebase — the static, compile-time theme applier in `layout.tsx`
(never user data; verified this sweep). DB-sourced URLs pass through
`safeUrl()` (scheme allow-list — now pinned by unit tests). Markdown renders
through the safe element-builder in `src/lib/markdown.tsx` (no HTML
injection). All queries go through the Supabase client (parameterized;
no string SQL). CSV exports are formula-injection-guarded (tested).
Value-level constraints (kind checks, non-empty checks) live in the schema.

## 4. Restrict API access to your own domain — ✅ with a caveat
The app itself is only served from the Vercel domains, and the CSP in
`next.config.ts` locks what the pages may load/execute. The Supabase REST
API cannot be origin-locked — and that is by design: an `Origin` header is
attacker-controlled, so it is **not** a security boundary. The real boundary
is the JWT + RLS on every row (item 1). The anon key is publishable by
design and grants nothing RLS doesn't allow.

## 5. Limit API rate — ✅ platform / 🖐 optional upgrade
Supabase rate-limits the sensitive auth endpoints (OTP issuance, token
grants) per IP out of the box. PostgREST traffic is bounded by RLS scope +
connection pooling. If abuse ever becomes real, the upgrade path is the
Supabase dashboard's auth rate-limit panel and/or Vercel WAF rules — both
config, no code.

## 6. Custom error screens — 🔧 shipped
`src/app/not-found.tsx` (styled 404 → back to Dashboard),
`src/app/error.tsx` (route crash boundary with **Try again** + digest ref),
`src/app/global-error.tsx` (root-layout crash, inline-styled last resort).

## 7. Index main queries — 🔧 shipped
Migration `security_hardening_and_fk_indexes` added covering indexes for
**all 68 foreign keys** the performance advisor flagged (case detail joins,
profile lookups, intel cross-refs, cascade deletes). Existing hot-path
indexes (case_id lookups, `indicators` value/case, trigram search) predate
this sweep. Advisor also notes a few *overlapping permissive policies*
(profiles/announcements/feedback) — intentional "own row OR command" pairs;
minor planner overhead, kept for clarity.

## 8. Basic logs and alerts — ✅ platform + audit log
Every mutation is captured server-side by the `private.audit()` trigger into
`audit_log` (owner-only screen, exportable to CSV). Vercel keeps
build/runtime logs per deployment; Supabase keeps API/Postgres/Auth logs
(Dashboard → Logs) with configurable alert emails. No secrets are ever
logged client-side.

## 9. Blue-green deployment for rollbacks — ✅ platform
Vercel gives this for free: every deployment is immutable; production merely
*points* at one. **Instant Rollback** (Dashboard → Deployments → ⋯ →
Rollback) flips the pointer back in seconds with zero downtime — same
guarantee blue-green provides. DB migrations are kept additive so an app
rollback never needs a schema rollback.

## 10. Continuous integration and automated tests — 🔧 shipped
`.github/workflows/ci.yml` runs on every push/PR: `tsc --noEmit`,
`eslint --max-warnings 0`, `vitest run`, `next build`. First unit tests pin
the security-sensitive pure functions: `safeUrl` scheme allow-list, the CSV
formula-injection guard, filename slugs. Vercel previews remain the
integration check.

## 11. Encrypt sensitive data — ✅ platform + key hygiene
Supabase encrypts the database at rest (AES-256) and all traffic in transit
(TLS). Secrets live server-side only: `app_secrets` has RLS enabled with
**no policies** (deny-all to client roles — deliberate), and the
`service_role` key exists only in env vars, never in the repo. The committed
keys (anon/publishable, FiveManage) are public-by-design client keys.

## 12. Update dependencies regularly — 🔧 shipped
`.github/dependabot.yml`: weekly npm + GitHub Actions updates, minors/patches
grouped, every update PR gated by CI. Current `npm audit`: 2 moderate
advisories inside Next.js's own pinned `postcss` (build-time only; we are on
the latest Next 16.2.10 — Dependabot will pick up the fix release).

## 13. Role-based access control — ✅ (core design)
Roles (member → bureau lead → deputy director → director/command) and
bureaus live on `profiles`; every policy and the sign-off routing chain
derive from them server-side. The UI's `canEdit`/`canDelete` gates are
cosmetic conveniences — the database is the authority. New accounts are
inert until Command activates them.

## 14. Regular data backups — 🖐 dashboard
Supabase runs daily automated backups on paid plans (Dashboard → Database →
Backups; PITR available as an add-on). Verify the project's plan includes
them — if it's on Free, either upgrade or ask for a scheduled-export
routine (a weekly CSV/SQL dump) and it can be built. Storage is external
(FiveManage) and the repo itself is the config/code backup.
