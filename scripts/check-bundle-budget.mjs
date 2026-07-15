/** Bundle budget gate — fails when the SHARED first-load JS (the chunks every
 *  app-router page ships: .next/build-manifest.json `rootMainFiles`) exceeds
 *  the budget. Run AFTER `npm run build`; needs no analyzer, no network.
 *
 *      npm run build && npm run check:bundle
 *
 *  Metric: gzip (zlib level 9, deterministic) of the rootMainFiles chunks —
 *  the wire cost every page pays before any route code. Raw bytes are
 *  printed for context but not gated (route chunks are covered by the
 *  advisory Lighthouse budget; this gate stays narrow on the shared core).
 *
 *  Re-baselining (intentional dependency/framework changes only):
 *    1. `npm run build && npm run check:bundle` — read the measured value;
 *    2. set BUDGET_GZIP_KB to measured * 1.10 (rounded up) below;
 *    3. explain the shift in the PR (what got bigger and why it is worth it).
 *  Baseline 2026-07-15: measured 128.9 KB gzip (445.9 KB raw, 5 chunks)
 *  -> budget 142 KB. NOTE: measured mid-sweep of src/; re-baseline on the
 *  merged tree before promoting the CI step from advisory to blocking.
 *
 *  Deep-dive when it trips: `npx next experimental-analyze` (Turbopack) or
 *  `ANALYZE=1 npm run build` (@next/bundle-analyzer, wired in next.config.ts;
 *  webpack builds only — Turbopack prints a notice and skips the report). */
import { readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'

const BUDGET_GZIP_KB = 142

let manifest
try {
  manifest = JSON.parse(readFileSync('.next/build-manifest.json', 'utf8'))
} catch {
  console.error('check-bundle-budget: .next/build-manifest.json not found — run `npm run build` first.')
  process.exit(1)
}

const shared = manifest.rootMainFiles ?? []
if (shared.length === 0) {
  console.error('check-bundle-budget: build-manifest.json has no rootMainFiles — did the Next build output format change?')
  process.exit(1)
}

let raw = 0
let gz = 0
for (const f of shared.filter((f) => f.endsWith('.js'))) {
  const p = path.join('.next', f)
  const buf = readFileSync(p)
  raw += statSync(p).size
  gz += gzipSync(buf, { level: 9 }).length
}

const kb = (n) => (n / 1024).toFixed(1)
console.log(`shared first-load JS (${shared.length} chunks): ${kb(gz)} KB gzip (${kb(raw)} KB raw) — budget ${BUDGET_GZIP_KB} KB gzip`)
if (gz > BUDGET_GZIP_KB * 1024) {
  console.error(`bundle-budget FAILED: ${kb(gz)} KB gzip > ${BUDGET_GZIP_KB} KB budget.`)
  console.error('Inspect with `npx next experimental-analyze` (or ANALYZE=1 on a webpack build),')
  console.error('trim the shared core, or re-baseline deliberately (see this script’s header).')
  process.exit(1)
}
console.log('bundle-budget OK')
