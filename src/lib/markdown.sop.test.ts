/** The active CID SOP, version 3 — pinned as it will render.
 *
 *  The corrected text lives in ONE place, the migration that applies it, and
 *  this test reads it from there: the file on disk is the file that was
 *  reviewed and the file that was applied, so what is checked here is what
 *  a reader gets. It pins three things the brief asked for and nothing can
 *  otherwise enforce:
 *
 *   · STRUCTURE — twelve Titles in order, every clause anchored, no export
 *     artifacts (the "Tab 1" line, the underscore rules), no duplicated
 *     heading, the callouts where the policy has a rule worth the emphasis.
 *   · LINKS — every /guides/… target names a document that exists in the
 *     library. A related-document callout that opens "not found" is worse
 *     than none.
 *   · TERMINOLOGY — the item-27 audit. None of the retired vocabulary
 *     survives in the active text: the jurisdiction bureaus, the retired
 *     justice roles, the old UC regime, the old bureau codes, the numbering
 *     the export got wrong. Generic words that merely share letters with a
 *     retired term ("prosecutorial integrity") are allowed on purpose.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { DocCallout } from '@/components/guides/DocCallout'
import { renderDocumentMarkdown } from './markdown'

const MIGRATION = join(process.cwd(), 'supabase/migrations/20261113120000_cid_sop_v3.sql')

/** The dollar-quoted body, exactly as the UPDATE will store it. */
function sopBody(): string {
  const sql = readFileSync(MIGRATION, 'utf8')
  const m = /\$sop\$([\s\S]*?)\$sop\$/.exec(sql)
  if (!m) throw new Error('no $sop$ body in the migration')
  return m[1]
}

/** Every document a link may point at. Kept here rather than read from the
 *  database so the test is deterministic; it is the library as of the
 *  migration, and a new slug is added when a new document is. */
const LIBRARY_SLUGS = new Set([
  'action-center', 'case-assignment-procedure', 'case-management', 'cid-case-building-playbook',
  'cid-investigative-report', 'cid-roster', 'cid-sop-superseded-2026-06', 'undercover-procedure',
  'cid-standard-operating-procedure', 'entities-organizations', 'legal-requests', 'user-guide',
  'raid-seizure-allocation-form', 'reports-evidence', 'special-investigations-bureau-sop',
  'special-ops-roster', 'uc-operation-activity-report', 'undergrnd', 'vanilla-unicorn',
])

function elements(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = []
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (isValidElement(n)) {
      out.push(n)
      walk((n.props as { children?: ReactNode }).children)
    }
  }
  walk(node)
  return out
}

describe('CID SOP v3 — the text the migration applies', () => {
  const body = sopBody()
  const { nodes, headings } = renderDocumentMarkdown(body)

  it('has the twelve Titles, in order, as the table of contents', () => {
    expect(headings.filter((h) => h.level === 2).map((h) => h.text)).toEqual([
      'Title 1 | Introduction',
      'Title 2 | Chain of Command',
      'Title 3 | Equipment',
      'Title 4 | Patrol Policies',
      'Title 5 | Case Management',
      'Title 6 | Confidential Informant (CI) Policy',
      'Title 7 | Surveillance and Undercover Operations',
      'Title 8 | Joint Operations and Inter-Bureau Cooperation',
      'Title 9 | Disciplinary and Professional Standards',
      'Title 10 | Training and Certifications',
      'Title 11 | Administrative Policies',
      'Title 12 | Detective Compensation',
    ])
  })

  it('numbers every sub-title and clause under its Title, with no duplicates and no gaps', () => {
    const subs = headings.filter((h) => h.level === 3).map((h) => h.text.split(' | ')[0])
    // Title 7 is 7A / 7B / 7C — the export's missing 7B is gone.
    expect(subs.filter((s) => s.startsWith('7'))).toEqual(['7A', '7B', '7C'])
    // Title 2C's clauses carry 2C, not 2B.
    const clauses = headings.filter((h) => h.level === 4).map((h) => h.text.split(' | ')[0])
    expect(clauses.filter((c) => c.startsWith('2C'))).toEqual(['2C.1', '2C.2'])
    expect(clauses).not.toContain('2B.2')
    expect(clauses).not.toContain('2B.3')
    // Every clause sits under the sub-title it is numbered for.
    let current = ''
    for (const h of headings) {
      if (h.level === 3) current = h.text.split(' | ')[0]
      if (h.level === 4) expect(h.text.split(' | ')[0].split('.')[0]).toBe(current)
    }
    // Ids are unique — no heading was emitted twice.
    const ids = headings.map((h) => h.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.some((id) => id.endsWith('-2'))).toBe(false)
  })

  it('carries no export artifacts and does not restate its own title', () => {
    expect(body).not.toMatch(/^Tab \d+$/m)
    expect(body).not.toMatch(/_{4,}/)
    expect(body).not.toMatch(/\r/)
    expect(body).not.toMatch(/\t/)
    expect(body).not.toMatch(/^Criminal Investigation Division \(CID\) Standard Operating Procedure$/m)
    // No blank heading, no heading immediately followed by another of the same level.
    expect(body).not.toMatch(/^#{2,4}\s*$/m)
  })

  it('uses callouts where the brief asked for them, and only there', () => {
    const callouts = elements(nodes)
      .filter((e) => e.type === DocCallout)
      .map((e) => e.props as { kind: string; title?: string })
    const kinds = callouts.map((c) => c.kind)
    expect(kinds.filter((k) => k === 'important')).toHaveLength(1)   // 12-hour reporting
    expect(kinds.filter((k) => k === 'warning')).toHaveLength(1)     // evidence destruction
    expect(kinds.filter((k) => k === 'restricted')).toHaveLength(1)  // CI identity
    expect(callouts.filter((c) => c.title === 'Related documents')).toHaveLength(5)
    expect(callouts.some((c) => c.title === 'CID Undercover Operations Procedure')).toBe(true)
    // Selective: nothing else was boxed.
    expect(callouts.length).toBeLessThanOrEqual(10)
  })

  it('links only to documents that exist in the library, and never to the superseded SOP', () => {
    const targets = [...body.matchAll(/\]\((\/guides\/([a-z0-9-]+)(?:#[a-z0-9-]+)?)\)/g)]
    expect(targets.length).toBeGreaterThanOrEqual(9)
    for (const [, , slug] of targets) expect(LIBRARY_SLUGS.has(slug), slug).toBe(true)
    expect(targets.some(([, , slug]) => slug === 'cid-sop-superseded-2026-06')).toBe(false)
    expect(targets.some(([, , slug]) => slug === 'undercover-procedure')).toBe(true)
    expect(targets.some(([, , slug]) => slug === 'uc-operation-activity-report')).toBe(true)
    expect(targets.some(([, , slug]) => slug === 'raid-seizure-allocation-form')).toBe(true)
  })

  it('item 27 — none of the retired terminology survives in the active text', () => {
    const banned: [RegExp, string][] = [
      [/LSPD CID|BCSO CID|SAHP CID/i, 'jurisdiction bureaus'],
      [/Los Santos CID|Blaine County Sheriff|Statewide Investigations CID|San Andreas Highway Patrol/i, 'jurisdiction bureaus (long form)'],
      [/Firearms\s*&\s*Drug/i, 'Firearms & Drug Enforcement'],
      [/\b(LSB|BCB|SAB)\b/, 'old bureau codes'],
      [/\bSIU\b/, 'SIU (should read SIB)'],
      [/\bADAs?\b/, 'ADA'],
      [/\bDA\b/, 'DA'],
      [/Assistant District Attorney|District Attorney/i, 'retired justice role'],
      [/\bprosecutors?\b/i, 'prosecutor (the role)'],
      [/UC certification|certification for undercover|two \(2\) approved investigative/i, 'old UC certification regime'],
      [/deep undercover|joining (a )?gangs?/i, 'conversational UC wording'],
      [/serve as the assigned UC handler/i, 'Bureau Lead as automatic UC handler'],
      [/rename (the )?ticket|blaine-2000001|\/document\b/i, 'Discord instructions'],
      [/When you are using|you will typically|you should not be/i, 'conversational wording'],
      [/\b2B\.[23]\b/, '2B.2 / 2B.3 numbering'],
      [/\b7D\b/, '7D numbering'],
      [/three \(3\) operational bureaus/i, 'three bureaus'],
    ]
    for (const [re, label] of banned) {
      const m = re.exec(body)
      expect(m, `${label}: "${m?.[0]}"`).toBeNull()
    }
    // Generic words that share letters with a retired term are allowed.
    expect(body).toMatch(/prosecutorial integrity/)
  })

  it('names the current structure, roles and authorities', () => {
    for (const must of [
      'Major Crimes Bureau (MCB)', 'Street Crimes Bureau (SCB)', 'Special Investigations Bureau (SIB)',
      'Joint Task Force (JTF) Designation', 'JTF is not a permanent bureau',
      'Detective, Senior Detective, Bureau Lead, Deputy Director, Director',
      'decided by a Judge', 'Attorney General',
      'CID Undercover Operations Procedure',
      'Bureau Leads, the Deputy Director, the Director, and active members of the Special Investigations Bureau',
      'up to six (6) active confidential informants',
      'Archived Case', 'Intake, Active Investigation, Legal Process, Enforcement Ready, Pending Closure, and Closed',
      'Every access to an evidence item is logged',
      'requesting detective may not authorize their own request',
    ]) expect(body, must).toContain(must)
  })

  it('keeps the compensation brackets and the twelve-hour rule verbatim', () => {
    expect(body).toContain('| $1,000,000 – $2,499,999 | 60% |')
    expect(body).toContain('| $25,000,000 + | 20% |')
    expect(body).toContain('within twelve (12) hours of scene conclusion')
    expect(body).toContain('more than eight (8) violent felony convictions')
    expect(body).toContain('three (3) to five (5) days')
  })
})
