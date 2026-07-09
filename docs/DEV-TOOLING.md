# Developer Tooling & MCP — Setup & Governance

Optional, developer-facing tooling that speeds up building and operating the
CID Portal. **None of it is a runtime dependency.** The app builds, deploys,
and runs identically with every item here disconnected — that is a hard design
rule, not an aspiration. Nothing below sends case data, reports, evidence,
personnel records, audit logs, or authentication data to any external service.

Companion to [`RUNBOOK.md`](RUNBOOK.md) (operating the live project).

---

## What this is (and isn't)

**MCP (Model Context Protocol)** connects an AI *agent* (e.g. Claude Code) to
tools and data. It is a **development-time** convenience, configured per
developer/session — never wired into the deployed application. The three MCP
servers here are declared in [`.mcp.json`](../.mcp.json) at the repo root and
must be **authorized interactively** in a Claude Code session (`/mcp`); no
tokens are committed.

**Semgrep** and **Lighthouse** are not "MCPs" — they are self-hosted OSS CLIs
wired into CI as **advisory** (non-blocking) jobs in
[`.github/workflows/code-quality.yml`](../.github/workflows/code-quality.yml).
They run fully local on the runner; findings/results never leave it.

> ⚠️ **The one rule that never bends:** the Supabase MCP (used in development
> for migrations/advisors/type-gen) uses elevated access that **bypasses RLS**.
> It is a developer tool only and must never be exposed to the app runtime or
> to end users. RLS remains the sole authority for the running product.

---

## The five tools

### 1. Vercel MCP — build/runtime observability
- **Why:** the only runtime telemetry today is the client-side `client_errors`
  table; this adds build logs, runtime logs, and deployment status (the
  server/SSR side you otherwise can't see).
- **Connect:** `/mcp` in Claude Code → authorize `vercel` via OAuth. No token
  in the repo.
- **Data transmitted:** queries against logs Vercel *already* holds for your
  project. **Stored externally:** none new. **Retention:** Vercel's existing
  log retention. **Privacy:** logs may contain PII only if the app logs it (it
  logs almost nothing server-side). **Self-hosted alternative:** the existing
  `client_errors` pipeline (stays). **Vendor lock-in:** none (reads your host).
  **Cost:** $0 (included). **Complexity:** Low. **ROI:** High.

### 2. Context7 MCP — current library docs
- **Why:** Next.js 16 / React 19 / Tailwind v4 are bleeding-edge; model
  knowledge lags them.
- **Connect:** declared in `.mcp.json` (stdio, `npx @upstash/context7-mcp`); no
  auth needed for basic use.
- **Data transmitted:** only the doc query you send — **never case data.**
  **Stored externally:** none. **Retention:** none (request/response).
  **Privacy:** negligible (public-docs lookups). **Self-hosted alternative:**
  vendoring docs (not worth it). **Vendor lock-in:** none. **Cost:** $0.
  **Complexity:** Low. **ROI:** High for the effort.

### 3. Playwright MCP — drive a real browser
- **Why:** the E2E shim can't render signed-in, role-gated screens; a real
  browser closes that verification gap and powers visual regression.
- **Connect:** declared in `.mcp.json` (stdio, `npx @playwright/mcp`); fully
  local.
- **Data transmitted:** none leaves the machine. Point it at **preview** builds
  with **seeded** accounts, never production PII. **Stored externally:** none.
  **Retention:** none. **Privacy:** strong if test data is synthetic.
  **Self-hosted alternative:** this *is* self-hosted. **Vendor lock-in:** none
  (OSS). **Cost:** $0. **Complexity:** Medium. **ROI:** High.

### 4. Semgrep (OSS) — static analysis, advisory CI
- **Why:** CI tests the RLS wall at runtime but nothing statically analyses app
  code (injection sinks, unsafe HTML, secret patterns).
- **Run:** `npm run sast` locally (needs `pip install semgrep`), or the
  advisory `sast` CI job. Uses public OSS rulesets (`p/typescript`, `p/react`,
  `p/nextjs`, `p/secrets`) downloaded to the machine.
- **Data transmitted:** **none** — `semgrep scan` runs locally; we deliberately
  do **not** use `semgrep ci` (which uploads findings to the Semgrep AppSec
  Platform). **Stored externally:** none. **Retention:** none. **Privacy:**
  excellent (self-hosted). **Self-hosted alternative:** this *is* it (OSS).
  **Vendor lock-in:** none. **Cost:** $0 (OSS). **Complexity:** Medium.
  **ROI:** Medium-High.

### 5. Lighthouse (LHCI) — performance budget, advisory CI
- **Why:** no automated performance budget exists; bundle/route weight can
  drift unnoticed.
- **Run:** `npm run perf` locally, or the advisory `perf` CI job. Config in
  [`lighthouserc.json`](../lighthouserc.json).
- **Data transmitted:** **none** — LHCI runs headless against a local
  `next start` and writes results to `.lighthouseci/` (`upload.target:
  filesystem`). We do **not** use Google PageSpeed Insights (which would send
  the URL to Google). **Stored externally:** none. **Retention:** none.
  **Privacy:** excellent (local). **Self-hosted alternative:** this *is* it.
  **Vendor lock-in:** none. **Cost:** $0. **Complexity:** Low-Medium.
  **ROI:** Medium.

---

## Visual regression — end-to-end verification plan

Config: [`playwright.visual.config.ts`](../playwright.visual.config.ts).
Baselines are committed under `tests/visual/__screenshots__/` and reviewed like
code — no third-party visual service.

- **Now:** `tests/visual/gate.visual.spec.ts` snapshots the public sign-in gate
  at mobile + desktop widths (renders without auth; works even in the sandbox).
- **Generate/refresh baselines:** `npm run build && npm run test:visual:update`
  (needs a Chromium; set `PW_CHROMIUM_PATH` to a preinstalled binary).
- **Check:** `npm run test:visual` — fails on unexpected pixel drift.
- **Next (needs seeded preview accounts):** add role-gated snapshots — Command
  Center per role, a case detail, a registry — using throwaway accounts against
  a **non-production** Supabase project/branch, exactly like the RLS suite.
  Then this becomes the automated pre-deploy verification step: build → E2E →
  visual diff → report.

---

## Promoting advisory gates to blocking

The `sast` and `perf` CI jobs are `continue-on-error: true` so an untuned rule
or a flaky run never blocks a merge. Once a baseline is trusted, drop
`continue-on-error` for that job to make it a required gate. Keep the blocking
gates in [`ci.yml`](../.github/workflows/ci.yml) authoritative.
