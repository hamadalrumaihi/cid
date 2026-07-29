/** Proof: MSW cannot ship to production.
 *
 *  1. Static import graph — no module under src/app, src/components, or
 *     src/lib may import src/mocks (only tests and the mock layer itself
 *     may). This is the guarantee that the Next build can never pull the
 *     mock layer in: nothing reachable from app code references it.
 *  2. Build output — every module under src/mocks carries the literal
 *     MSW_BUNDLE_SENTINEL (src/mocks/env.ts); if a previously built .next/
 *     exists, scan every emitted JS chunk for the sentinel and for MSW's own
 *     unmistakable markers. Self-skips when no build is present (offline
 *     unit runs stay green); CI runs `npm run build` before `npm test`'s
 *     sibling gates, and check 1 holds regardless.
 *  3. public/ — the browser service-worker script is deliberately NOT
 *     generated in Phase 1 (public/ ships verbatim); assert it stays absent
 *     until the Storybook phase puts it in Storybook's own static dir. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MSW_BUNDLE_SENTINEL } from '@/mocks/env'

const repoRoot = path.resolve(__dirname, '..', '..')

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full, exts))
    else if (exts.some((e) => entry.endsWith(e))) out.push(full)
  }
  return out
}

/** Import/require/export-from specifiers in a source file. */
function importSpecifiers(source: string): string[] {
  const out: string[] = []
  const re = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g
  for (let m = re.exec(source); m; m = re.exec(source)) out.push(m[1])
  return out
}

const isMocksImport = (spec: string, file: string): boolean => {
  if (spec === '@/mocks' || spec.startsWith('@/mocks/')) return true
  if (!spec.startsWith('.')) return false
  const resolved = path.resolve(path.dirname(file), spec)
  return resolved === path.join(repoRoot, 'src', 'mocks') ||
    resolved.startsWith(path.join(repoRoot, 'src', 'mocks') + path.sep)
}

describe('production exclusion — static import graph', () => {
  it('no app code (src/app, src/components, src/lib) imports src/mocks', () => {
    const offenders: string[] = []
    for (const root of ['src/app', 'src/components', 'src/lib']) {
      for (const file of walk(path.join(repoRoot, root), ['.ts', '.tsx'])) {
        const source = readFileSync(file, 'utf8')
        if (importSpecifiers(source).some((spec) => isMocksImport(spec, file))) {
          offenders.push(path.relative(repoRoot, file))
        }
      }
    }
    expect(offenders, `app code must never import src/mocks: ${offenders.join(', ')}`).toEqual([])
  })

  it('the sentinel really is carried by the mock layer (self-check)', () => {
    // Guards against the scan silently passing because the sentinel moved.
    const envSource = readFileSync(path.join(repoRoot, 'src/mocks/env.ts'), 'utf8')
    expect(envSource).toContain(MSW_BUNDLE_SENTINEL)
    const storeSource = readFileSync(path.join(repoRoot, 'src/mocks/store.ts'), 'utf8')
    expect(storeSource).toContain('MSW_BUNDLE_SENTINEL')
  })
})

describe('production exclusion — build output', () => {
  const nextDir = path.join(repoRoot, '.next')
  const hasBuild = existsSync(path.join(nextDir, 'build-manifest.json'))

  it.skipIf(!hasBuild)('no emitted JS chunk contains the MSW sentinel or MSW markers', () => {
    const staticDir = path.join(nextDir, 'static')
    const chunks = existsSync(staticDir) ? walk(staticDir, ['.js']) : []
    expect(chunks.length).toBeGreaterThan(0)
    const dirty = chunks.filter((f) => {
      const body = readFileSync(f, 'utf8')
      return body.includes(MSW_BUNDLE_SENTINEL) ||
        body.includes('mockServiceWorker') ||
        body.includes('[MSW]')
    })
    expect(dirty.map((f) => path.relative(repoRoot, f)),
      'MSW leaked into the client build').toEqual([])
  })

  it.skipIf(!hasBuild)('the shared first-load chunks (bundle-budget set) are MSW-free', () => {
    const manifest = JSON.parse(readFileSync(path.join(nextDir, 'build-manifest.json'), 'utf8')) as {
      rootMainFiles?: string[]
    }
    const shared = (manifest.rootMainFiles ?? []).filter((f) => f.endsWith('.js'))
    expect(shared.length).toBeGreaterThan(0)
    for (const f of shared) {
      const body = readFileSync(path.join(nextDir, f), 'utf8')
      expect(body.includes(MSW_BUNDLE_SENTINEL), `${f} contains the MSW sentinel`).toBe(false)
    }
  })
})

describe('production exclusion — public/', () => {
  it('the MSW service-worker script is not generated into public/ (deferred to Storybook phase)', () => {
    expect(existsSync(path.join(repoRoot, 'public', 'mockServiceWorker.js'))).toBe(false)
  })
})
