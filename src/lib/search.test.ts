import { describe, expect, it } from 'vitest'
import { useProfilesStore, type RosterProfile } from './profiles'
import { boloHitSublabel, legalHitSublabel, memberHits, tipHitsFromMatches, SEARCH_KINDS, SEARCH_SECTION_ORDER } from './search'

/** The search_all RPC emits `initcap(request_type) · replace(review_status,
 *  '_', ' ')` for legal hits; the client re-derives the workflow model's human
 *  status label from that token (the RPC itself is untouchable and untouched). */
describe('legalHitSublabel', () => {
  it('maps the machine status token to the model label (retired stages keep their history label)', () => {
    // Retired stages (P4-01) render read-only with the "Retired stage" prefix.
    expect(legalHitSublabel('Warrant · submitted to doj'))
      .toBe('Warrant · Retired stage — Submitted to DOJ')
    expect(legalHitSublabel('Subpoena · returned by ada'))
      .toBe('Subpoena · Retired stage — Returned by ADA')
    // Live stages use the L5 labels.
    expect(legalHitSublabel('Warrant · submitted to judge')).toBe('Warrant · Awaiting judge')
    expect(legalHitSublabel('Warrant · judicial review'))
      .toBe('Warrant · Under judicial review')
    expect(legalHitSublabel('Warrant · returned by judge'))
      .toBe('Warrant · Returned for revision (judge)')
    expect(legalHitSublabel('Warrant · partially approved')).toBe('Warrant · Partially approved')
    expect(legalHitSublabel('Warrant · approved')).toBe('Warrant · Approved')
  })

  it('keeps the type prefix untouched', () => {
    expect(legalHitSublabel('Warrant · denied')).toBe('Warrant · Denied')
  })

  it('passes unknown tokens and non-legal shapes through unchanged', () => {
    expect(legalHitSublabel('Warrant · some future status')).toBe('Warrant · some future status')
    expect(legalHitSublabel('no separator here')).toBe('no separator here')
    expect(legalHitSublabel('')).toBe('')
    expect(legalHitSublabel(null)).toBeNull()
  })
})

/** The bolo arm emits `'BOLO · ' || bolo_risk [ || ' · expired']` with the
 *  raw lowercase risk (possibly empty when the flag has no risk set). */
describe('boloHitSublabel', () => {
  it('re-cases the risk through the status registry', () => {
    expect(boloHitSublabel('BOLO · high')).toBe('BOLO · High')
    expect(boloHitSublabel('BOLO · critical · expired')).toBe('BOLO · Critical · expired')
  })

  it('drops the empty segment when no risk is set', () => {
    expect(boloHitSublabel('BOLO · ')).toBe('BOLO')
    expect(boloHitSublabel('BOLO ·  · expired')).toBe('BOLO · expired')
  })

  it('passes non-bolo shapes through unchanged', () => {
    expect(boloHitSublabel('Warrant · approved')).toBe('Warrant · approved')
    expect(boloHitSublabel(null)).toBeNull()
  })
})

describe('tipHitsFromMatches', () => {
  it('maps submission matches to capped tip hits with no title', () => {
    const m = new Map<string, string[]>([
      ['a', ['a person', 'the thread']],
      ['b', []],
    ])
    const hits = tipHitsFromMatches(m)
    expect(hits).toHaveLength(2)
    expect(hits[0]).toMatchObject({ kind: 'tip', id: 'a', label: 'Intelligence report', sublabel: 'Matched a person, the thread' })
    expect(hits[1].sublabel).toBeNull()
    const many = new Map(Array.from({ length: 10 }, (_, i) => [`id${i}`, []] as [string, string[]]))
    expect(tipHitsFromMatches(many)).toHaveLength(6)
  })
})

describe('memberHits', () => {
  const roster = (over: Partial<RosterProfile>): RosterProfile => ({
    id: 'p1', display_name: 'Ray Vargas', avatar_url: null, badge_number: '4471',
    division: 'major_crimes', role: 'senior_detective', active: true,
    created_at: '', updated_at: '', loa: false, loa_since: null, discord_id: null,
    removed_at: null, is_owner: false, login_denied: false, is_system: false,
    ...over,
  })

  it('matches name / badge / role against the roster cache', () => {
    useProfilesStore.setState({
      profiles: [
        roster({}),
        roster({ id: 'p2', display_name: 'Ana Cole', badge_number: '9001', role: 'detective' }),
        roster({ id: 'p3', display_name: 'Gone Member', active: false }),
      ],
      loaded: true,
    })
    expect(memberHits('vargas').map((h) => h.id)).toEqual(['p1'])
    expect(memberHits('9001').map((h) => h.id)).toEqual(['p2'])
    expect(memberHits('senior detective').map((h) => h.id)).toEqual(['p1'])
    // Inactive members never surface.
    expect(memberHits('gone')).toEqual([])
    const hit = memberHits('vargas')[0]
    expect(hit).toMatchObject({ kind: 'member', label: 'Ray Vargas', sublabel: 'Senior Detective · Major Crimes' })
  })

  it('returns nothing for a blank query or an empty cache', () => {
    expect(memberHits('  ')).toEqual([])
    useProfilesStore.setState({ profiles: [], loaded: false })
    expect(memberHits('vargas')).toEqual([])
  })
})

describe('search section registry', () => {
  it('covers every ordered section (unknown kinds are dropped by the palette)', () => {
    for (const kind of SEARCH_SECTION_ORDER) expect(SEARCH_KINDS[kind]).toBeTruthy()
    // The two RPC additions and the two client-side arms are registered.
    for (const kind of ['task', 'bolo', 'tip', 'member']) {
      expect(SEARCH_KINDS[kind]).toBeTruthy()
      expect(SEARCH_SECTION_ORDER).toContain(kind)
    }
  })
})

/* ── Platform upgrade (§5.2 Search): headline rendering + the two FTS kinds ── */
import { documentHitsFromRows, headlineText, sourceHitsFromRows, splitHeadline } from './search'

describe('splitHeadline / headlineText', () => {
  it('splits ts_headline output into text and bold segments — never HTML', () => {
    expect(splitHeadline('the <b>dock</b> lease <b>2026</b>')).toEqual([
      { text: 'the ', bold: false }, { text: 'dock', bold: true }, { text: ' lease ', bold: false }, { text: '2026', bold: true },
    ])
    // Any other tag-looking text is content, not markup.
    expect(splitHeadline('<script>x</script> <b>y</b>')).toEqual([{ text: '<script>x</script> ', bold: false }, { text: 'y', bold: true }])
    expect(splitHeadline('')).toEqual([])
    expect(splitHeadline(null)).toEqual([])
    expect(headlineText('  the <b>dock</b>\n lease ')).toBe('the dock lease')
  })
})

describe('document / source hits', () => {
  const C = '11111111-2222-4333-8444-555555555555'
  const M = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  it('document_search rows → "Case documents" hits with a page deep link and the evidence number', () => {
    const [h] = documentHitsFromRows([{ media_id: M, case_id: C, title: 'Lease', evidence_number: 'EV-000004', page_no: 3, headline: 'the <b>dock</b>', rank: 0.4 }])
    expect(h).toMatchObject({
      kind: 'document_page', id: `${M}:3`, label: 'Lease · EV-000004', sublabel: 'Page 3 · the dock', headline: 'the <b>dock</b>', rank: 0.4,
      href: `/cases?case=${C}&tab=documents&media=${M}&page=3`,
    })
    // No case → no href (the palette routes by kind); untitled → "Document".
    const [n] = documentHitsFromRows([{ media_id: M, case_id: null, title: '', evidence_number: null, page_no: 1, headline: '', rank: 0 }])
    expect(n.href).toBeUndefined()
    expect(n.label).toBe('Document')
    expect(n.sublabel).toBe('Page 1')
    expect(documentHitsFromRows(Array.from({ length: 12 }, (_, i) => ({ media_id: M, case_id: C, title: 't', evidence_number: null, page_no: i, headline: '', rank: 0 })))).toHaveLength(8)
  })

  it('external_source_search rows → source hits: number + title, the domain, never a URL', () => {
    const [h] = sourceHitsFromRows([{ source_id: 's1', source_number: 'SRC-000001', title: 'Port notice', domain: 'example.org', headline: '<b>dock</b> closed', rank: 0.3 }])
    expect(h).toMatchObject({ kind: 'source', id: 's1', label: 'SRC-000001 · Port notice', sublabel: 'example.org · dock closed', href: '/intelligence?source=s1' })
    expect(JSON.stringify(h)).not.toContain('http')
    const [u] = sourceHitsFromRows([{ source_id: 's2', source_number: 'SRC-000002', title: null, domain: 'x.example', headline: '', rank: 0 }])
    expect(u.label).toBe('SRC-000002')
    expect(u.sublabel).toBe('x.example')
  })

  it('the section registry knows both kinds and orders them after documents', () => {
    expect(SEARCH_KINDS.document_page.title).toBe('Case documents')
    expect(SEARCH_KINDS.source.title).toBe('External sources')
    const order = [...SEARCH_SECTION_ORDER]
    expect(order.indexOf('document_page')).toBe(order.indexOf('document') + 1)
    expect(order.indexOf('source')).toBe(order.indexOf('document_page') + 1)
  })
})
