/** Vitest reporter that feeds the Owner Portal's Security Testing dashboard.
 *  After a live RLS run it signs in as the lsb fixture (anon key + password
 *  grant — the same credentials the suite itself used) and posts SANITIZED
 *  per-file results through security_test_report(), which is EXECUTE-guarded
 *  to rls-test accounts and re-sanitizes server-side. Reporting is strictly
 *  best-effort: any failure here logs a warning and never affects the run.
 *  No service key, no new secrets — self-skips when the env is absent. */
import { basename } from 'node:path'
import type { Reporter, TestModule } from 'vitest/node'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = process.env.RLS_TEST_PASSWORD_LSB || ''

const SUITE_NAME: Record<string, string> = {
  'rls.test.ts': 'RLS security wall',
  'legal.test.ts': 'DOJ legal review RLS',
  'v114.test.ts': 'Shared platform RLS (v1.14)',
}

interface Failure { name: string; expected: string; actual: string }

async function post(suite: string, counts: { passed: number; failed: number; skipped: number },
  failures: Failure[], durationMs: number, token: string): Promise<void> {
  const res = await fetch(`${URL}/rest/v1/rpc/security_test_report`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_suite: suite,
      p_passed: counts.passed,
      p_failed: counts.failed,
      p_skipped: counts.skipped,
      p_failures: failures,
      p_commit: process.env.GITHUB_SHA ?? null,
      p_branch: process.env.GITHUB_REF_NAME ?? null,
      p_release: process.env.npm_package_version ?? null,
      p_source: process.env.GITHUB_ACTIONS ? 'ci' : 'local',
      p_duration_ms: Math.round(durationMs),
    }),
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
}

export default class SecurityDashboardReporter implements Reporter {
  private startedAt = Date.now()

  onTestRunStart(): void {
    this.startedAt = Date.now()
  }

  async onTestRunEnd(testModules: ReadonlyArray<TestModule>): Promise<void> {
    if (!ANON || !PW) return // secretless run — nothing to report with
    try {
      const grant = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'rls-test-lsb@cidportal.test', password: PW }),
      })
      if (!grant.ok) throw new Error(`password grant ${grant.status}`)
      const { access_token } = (await grant.json()) as { access_token: string }
      const durationMs = Date.now() - this.startedAt

      for (const mod of testModules) {
        const file = basename(mod.moduleId)
        const suite = SUITE_NAME[file] ?? file
        const counts = { passed: 0, failed: 0, skipped: 0 }
        const failures: Failure[] = []
        for (const test of mod.children.allTests()) {
          const state = test.result().state
          if (state === 'passed') counts.passed++
          else if (state === 'failed') {
            counts.failed++
            const err = test.result().errors?.[0]
            // Sanitized: test name + trimmed assertion text only — the server
            // re-truncates and never accepts row payloads.
            failures.push({
              name: test.fullName.slice(0, 280),
              expected: '',
              actual: (err?.message ?? 'failed').split('\n')[0].slice(0, 280),
            })
          } else counts.skipped++
        }
        await post(suite, counts, failures, durationMs, access_token)
      }
      console.info('[security-dashboard] run reported')
    } catch (e) {
      console.warn('[security-dashboard] reporting skipped:', e instanceof Error ? e.message : e)
    }
  }
}
