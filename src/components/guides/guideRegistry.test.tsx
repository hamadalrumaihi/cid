/** `npm run check:guides` — the consistency check the registry's own comments
 *  promise.
 *
 *  The Guide Library is three things that have to agree: a library ROW in
 *  public.guides (seeded by migration), a BODY in this registry, and the
 *  section list every surface derives from it — the contents rail, the
 *  in-guide search, previous/next, the library's search results and each
 *  section's permanent link. Nothing at runtime forces them to match, and the
 *  failure mode is quiet: a section that stops being reachable, an anchor that
 *  silently changes and breaks a link somebody sent a colleague, a guide
 *  registered under a body key no module answers to.
 *
 *  This suite is where that gets caught. It is deliberately structural — it
 *  asserts nothing about prose, so writing a guide never fails it. */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { GUIDE_BODIES, guideBody } from './guideRegistry'
import { docHeadings, sectionText } from './guideDoc'

/** The body keys the seed migrations register, read from the migrations
 *  themselves rather than restated here — a list copied into a test is a
 *  fourth thing to keep in step. */
function seededBodyKeys(): string[] {
  const sql = [
    'supabase/migrations/20261108120000_guide_library_v2.sql',
    'supabase/migrations/20261109120000_guide_vanilla_unicorn.sql',
  ].map((f) => readFileSync(f, 'utf8')).join('\n')
  // Every library row seeds `body_key` as a quoted literal, either in the
  // VALUES tuple or in the named-column insert.
  //   20261108120000: ('slug', …, 'body-key', <pinned>, 'module', …)
  //   20261109120000: ('slug', …, 'body-key', 'module', …)
  // so the boolean between them is optional. The `body_kind` DDL in the same
  // file cannot match: its second literal is 'sections', not 'module'.
  const keys = new Set<string>()
  for (const m of sql.matchAll(/'([a-z0-9-]+)',\s*(?:(?:true|false),\s*)?'module'/g)) keys.add(m[1])
  for (const m of sql.matchAll(/body_key = '([a-z0-9-]+)'/g)) keys.add(m[1])
  return [...keys].sort()
}

const ANCHOR_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

describe('every registered guide has a usable body', () => {
  for (const [key, body] of Object.entries(GUIDE_BODIES)) {
    describe(key, () => {
      it('resolves through guideBody() and renders from something', () => {
        expect(guideBody(key)).toBe(body)
        // A guide renders from a document or from its own component. Neither
        // means the page has nothing to show.
        expect(body.doc ?? body.Body, 'has a doc or a Body').toBeTruthy()
      })

      it('has at least one section, and every section has a heading', () => {
        expect(body.sections.length).toBeGreaterThan(0)
        for (const s of body.sections) {
          expect(s.id, 'section id').toBeTruthy()
          expect(s.text.trim(), `heading for ${s.id}`).toBeTruthy()
        }
      })

      it('has unique, stable-looking anchors', () => {
        const ids = body.sections.map((s) => s.id)
        expect(new Set(ids).size, `duplicate anchor in ${key}`).toBe(ids.length)
        // UNDERGRND's anchors are prefixed (`u-overview`); both shapes are
        // lowercase-hyphenated, which is what a URL fragment needs to stay
        // linkable.
        for (const id of ids) expect(id, id).toMatch(ANCHOR_RE)
      })

      it('reports a sane reading estimate', () => {
        expect(body.readMinutes).toBeGreaterThan(0)
        expect(Number.isInteger(body.readMinutes), 'whole minutes').toBe(true)
      })

      it('records when its prose was last revised', () => {
        expect(Number.isNaN(Date.parse(body.lastUpdated)), body.lastUpdated).toBe(false)
      })
    })
  }
})

describe('the contents, the search and the page cannot disagree', () => {
  for (const [key, body] of Object.entries(GUIDE_BODIES)) {
    describe(key, () => {
      it('derives its contents from the document itself', () => {
        if (!body.doc) return // a self-rendering guide supplies its own list
        expect(body.sections).toEqual(docHeadings(body.doc))
      })

      it('matches every section on a blank query, and none on a nonsense one', () => {
        const all = body.matchSections('')
        expect(all.size, 'a blank query is the whole guide').toBe(body.sections.length)
        for (const s of body.sections) expect(all.has(s.id), s.id).toBe(true)
        expect(body.matchSections('zzzzz-no-such-words').size).toBe(0)
      })

      it('finds each section by a word that is actually in it', () => {
        if (!body.doc) return // UNDERGRND matches on transcribed values
        for (const section of body.doc.sections) {
          // The longest word in the heading is a word a reader would plausibly
          // search for, and one that must reach this section.
          const word = [...section.heading.split(/\s+/)]
            .map((w) => w.replace(/^[^A-Za-z]+|[^A-Za-z-]+$/g, ''))
            .sort((a, b) => b.length - a.length)[0]
          if (word.length < 4) continue
          expect(body.matchSections(word).has(section.anchor), `“${word}” → ${section.anchor}`).toBe(true)
        }
      })

      it('returns library search hits that point at real sections', () => {
        if (!body.doc) return
        const first = body.doc.sections[0]
        const word = sectionText(first).split(/\s+/).find((w) => w.length > 6)
        if (!word) return
        const ids = new Set(body.sections.map((s) => s.id))
        for (const hit of body.searchSections(word)) {
          expect(ids.has(hit.anchor), `hit ${hit.anchor} is a real section`).toBe(true)
          expect(hit.heading.trim()).toBeTruthy()
        }
        expect(body.searchSections('').length, 'a blank query is no search').toBe(0)
      })
    })
  }
})

describe('the registry and the library seeds agree', () => {
  it('registers a body for every seeded module guide, and seeds every body', () => {
    const seeded = seededBodyKeys()
    expect(seeded.length, 'found the seeded body keys').toBeGreaterThan(0)
    // Both directions: a seeded row with no body renders an empty page; a
    // registered body no row points at is dead weight nobody can reach.
    expect(Object.keys(GUIDE_BODIES).sort()).toEqual(seeded)
  })

  it('answers null for a body key nothing registers', () => {
    expect(guideBody('no-such-guide')).toBeNull()
    expect(guideBody(null)).toBeNull()
    expect(guideBody(undefined)).toBeNull()
  })
})
