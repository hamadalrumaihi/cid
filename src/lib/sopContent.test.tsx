/** Pins the canonical CID SOP content (the OdysseyRP SOP refresh migration —
 *  the single in-repo copy of the SOP body) against the real document
 *  renderer: all 12 Titles in order, subsection ordering, the Title 12C
 *  compensation table verbatim, deep-link anchor ids, and zero raw-markdown
 *  leakage. A future SOP refresh migration should update the path here. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderDocumentMarkdown } from './markdown'

const mig = readFileSync('supabase/migrations/20260809120000_cid_sop_odysseyrp_refresh.sql', 'utf8')
const body = (mig.match(/\$sop\$([\s\S]*?)\$sop\$/) as RegExpMatchArray)[1]

function elements(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = []
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (isValidElement(n)) { out.push(n); walk((n.props as { children?: ReactNode }).children) }
  }
  walk(node)
  return out
}

const text = (n: ReactNode): string => {
  if (typeof n === 'string') return n
  if (Array.isArray(n)) return n.map(text).join('')
  if (isValidElement(n)) return text((n.props as { children?: ReactNode }).children)
  return ''
}

describe('SOP body renders through renderDocumentMarkdown', () => {
  const { nodes, headings } = renderDocumentMarkdown(body)
  const els = elements(nodes)

  it('all 12 Titles appear as h2 headings, in order', () => {
    const titles = headings.filter((h) => /^Title \d+ \|/.test(h.text))
    expect(titles.map((h) => h.text)).toEqual([
      'Title 1 | Introduction',
      'Title 2 | Chain of Command',
      'Title 3 | Equipment',
      'Title 4 | Patrol Policies',
      'Title 5 | Case Management',
      'Title 6 | Confidential Informant (CI) Policy',
      'Title 7 | Surveillance & UC Operations',
      'Title 8 | Joint Operations & Inter-Bureau Cooperations',
      'Title 9 | Disciplinary & Professional Standards',
      'Title 10 | Training & Certifications',
      'Title 11 | Administrative Policies',
      'Title 12 | Detective Compensation',
    ])
    expect(titles.every((h) => h.level === 2)).toBe(true)
  })

  it('deep-link anchors: /?doc=…#title-5-case-management works', () => {
    const ids = headings.map((h) => h.id)
    expect(ids).toContain('title-5-case-management')
    expect(ids).toContain('title-2-chain-of-command')
    expect(ids).toContain('title-12-detective-compensation')
  })

  it('subsections render in correct order (spot-check Title 5 + Title 7)', () => {
    const ids = headings.map((h) => h.id)
    const seq = ['title-5-case-management', '5a-1-case-assignment-authority', '5a-4-case-status-definitions',
      '5b-1-reporting-requirements', '5b-2-major-incident-reporting', 'report-content-standards',
      '5c-1-evidence-collection', '5c-4-evidence-retention', '5d-4-ticket-timelines',
      '7c-wiretaps-and-electronic-intercepts', 'title-7d-surveillance-tracking-system', '7d-5-abuse-prevention-safeguards']
    const idx = seq.map((s) => ids.indexOf(s))
    expect(idx.every((n) => n >= 0)).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
  })

  it('compensation table renders with all five brackets exact', () => {
    const tables = els.filter((e) => e.type === 'table')
    expect(tables.length).toBe(1)
    const t = text(tables[0])
    expect(t).toContain('Street Value')
    expect(t).toContain('Percentage Given')
    for (const [v, p] of [
      ['$1,000,000-$2,499,999', '60%'], ['$2,500,000-$7,499,999', '50%'],
      ['$7,500,000-$14,999,999', '40%'], ['$15,000,000-$24,999,999', '30%'],
      ['$25,000,000+', '20%'],
    ]) { expect(t).toContain(v); expect(t).toContain(p) }
  })

  it('the Weapons and Attachments SOP link renders as an anchor', () => {
    const a = els.find((e) => e.type === 'a')
    expect(a).toBeDefined()
    expect((a!.props as { href: string }).href).toMatch(/^https:\/\/docs\.google\.com\//)
  })

  it('no raw markdown artifacts leak into rendered text', () => {
    const whole = text(nodes)
    expect(whole).not.toContain('**')
    expect(whole).not.toMatch(/^#/m)
    expect(whole).not.toContain('](http')
    expect(whole).not.toContain('Tab 1')
    // every bullet became a list item — no literal "* " paragraph starts
    const paras = els.filter((e) => e.type === 'p').map((e) => text(e))
    expect(paras.filter((p) => p.trimStart().startsWith('* '))).toEqual([])
  })

  it('document begins with the full SOP title', () => {
    expect(headings[0].text).toBe('Criminal Investigation Division (CID) Standard Operating Procedure')
  })

  it('lists render as ul/ol (spot totals)', () => {
    const uls = els.filter((e) => e.type === 'ul')
    expect(uls.length).toBeGreaterThan(30)
  })
})
