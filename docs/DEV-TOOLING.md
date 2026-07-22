# Developer Tooling & MCP — Setup & Governance

> Development tooling only. Nothing configured here is a runtime dependency
> or a feature of the CID Portal itself.

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

## The six tools

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

### 6. codebase-memory-mcp — repo navigation memory for the agent
- **Why:** this repo is large (~180 components, 130+ migrations, 90+ tables);
  an agent re-reads many files to locate code. This tool indexes the repo into
  a queryable graph so the agent finds the right symbols/files in fewer steps
  and fewer tokens. It helps *build* the Portal — it is **not** a feature and
  **not** a runtime dependency. Source:
  [`DeusData/codebase-memory-mcp`](https://github.com/DeusData/codebase-memory-mcp).
- **Install & connect:** it is a single self-contained binary (C, zero runtime
  deps). Run its installer on *your own machine* — it builds the binary and
  auto-wires it into your **user-scoped** `~/.claude.json`, so it is **not**
  added to the committed [`.mcp.json`](../.mcp.json) (that file stays limited to
  zero-config `npx`/`http` servers; a machine-specific binary path there would
  break `/mcp` for anyone who hasn't built it). After install, restart Claude
  Code and confirm with `/mcp`.
  - macOS/Linux: `curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash`
  - or build from source (`scripts/build.sh`; needs a C/C++ compiler + zlib).
  - Manual registration, if you prefer (user or project scope):
    ```json
    { "mcpServers": { "codebase-memory-mcp": { "command": "/path/to/codebase-memory-mcp", "args": [] } } }
    ```
- **Data transmitted:** **none** — indexing and queries run fully local against
  the working tree; nothing leaves the machine (no LLM calls, no cloud). It
  reads source only — never the live database, case data, or secrets.
  **Stored externally:** none (index lives locally). **Retention:** local index
  until you delete it. **Privacy:** excellent (offline). **Self-hosted
  alternative:** this *is* local/self-hosted. **Vendor lock-in:** none (drop it
  and the repo is unchanged). **Cost:** $0. **Complexity:** Low.
  **ROI:** Medium-High on a repo this size.

---

## Runtime-feature exception — Portal Assistant (page-agent)

> ⚠️ **Unlike everything else in this file, this one *is* a product feature**
> (it ships in the app bundle). It lives here only because its governance —
> external LLM, key handling, guardrails — is the same kind of concern. It is
> owner-only, opt-in, and inert by default.

An owner-only natural-language copilot ([`alibaba/page-agent`](https://github.com/alibaba/page-agent))
that drives the Portal UI. Source: `src/components/assistant/`. Design:

- **Owner-only.** `PortalAssistant` renders `null` for anyone who is not
  `useAuth().isOwner`.
- **Inert until configured.** page-agent is **lazy-imported on first run**, and
  only when `NEXT_PUBLIC_PAGE_AGENT_MODEL` / `_BASE_URL` / `_API_KEY` are all
  set. Unset → the panel shows a "not configured" note, imports nothing, makes
  no network call. (Confirmed: it stays out of the shared first-load bundle, so
  the bundle-budget gate is unaffected.)
- **Read / navigate / prepare only.** While the agent runs,
  `installDestructiveGuard` adds a capture-phase click interceptor that blocks
  destructive controls (delete / finalize / sign-off / issue warrant / revoke /
  approve / deny / merge / archive / submit …, or any `data-destructive`
  element) *before* React's handlers fire. This is **defense-in-depth** — RLS
  and the app's own confirmation dialogs (permanent-delete sudo, report
  finalize, sign-off, warrant issue) remain the real authority.
- **Data transmitted:** the agent reads the owner's **current screen** and sends
  it to the configured model. The API key is **browser-exposed** (`NEXT_PUBLIC_`)
  — use a **restricted / proxy key**, never a privileged one — and **do not run
  it on restricted / sealed records.** **Stored externally:** whatever the chosen
  model provider retains. **Self-hosted alternative:** point `_BASE_URL` at a
  local model. **Vendor lock-in:** none (any OpenAI-compatible endpoint).
  **Cost:** your model's. **Complexity:** Medium. **Status:** pilot.
- **Not yet verified live:** the agent execution path needs a real model/key to
  exercise end-to-end; it is inert (and therefore safe) until you configure one.

### Enabling it locally against Anthropic (recommended: via the proxy)

page-agent runs **in the browser**, and Anthropic's API refuses direct browser
calls (no CORS headers) — plus any `NEXT_PUBLIC_` key would be exposed to every
page viewer. `scripts/page-agent-proxy.mjs` solves both: it holds the real key
**server-side** and adds the CORS headers the browser needs. It's a thin
pass-through to Anthropic's OpenAI-compatible endpoint (`/v1/chat/completions`).

1. Start the proxy with your key (never `NEXT_PUBLIC_`):
   ```bash
   ANTHROPIC_API_KEY=sk-ant-... npm run assistant:proxy
   ```
2. `.env.local` (git-ignored) points the client at the proxy with a **dummy**
   token — the real key never reaches the browser:
   ```
   NEXT_PUBLIC_PAGE_AGENT_MODEL=claude-sonnet-5
   NEXT_PUBLIC_PAGE_AGENT_BASE_URL=http://localhost:8787/v1
   NEXT_PUBLIC_PAGE_AGENT_API_KEY=proxy
   ```
3. `npm run dev`, sign in as the Owner, click the ✦ button, and Run an
   instruction. Swap the model to `claude-haiku-4-5-20251001` for cheaper/faster.

For a deployed pilot (Vercel), stand the same proxy up as a serverless
route/function with the key in a **server-side** env var and point
`_BASE_URL` at it — do not put a real key in `NEXT_PUBLIC_`.

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
