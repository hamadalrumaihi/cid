/** The legal-request wizard is one centred column.
 *
 *  WHAT THIS PROVES, AND WHAT IT DOES NOT
 *  It is a static assertion over the source, not a rendering proof. The visual
 *  suite covers only the gate and roles screens, and screenshotting an
 *  authenticated wizard would need seeded-database Playwright infrastructure
 *  that does not exist here -- and must never be pointed at production.
 *
 *  So this pins the two things that actually regressed and that a reviewer
 *  cannot see in a diff: the workflow lives in ONE container, and that
 *  container is centred with a readable cap. Before this, the root was full
 *  width while only some children carried max-w-3xl and none were centred, so
 *  the form sat hard left with the rest of the row empty.
 *
 *  It also pins the negative that is easy to get wrong when "centre the form"
 *  is the instruction: the CONTAINER is centred, the CONTENT is not. A centred
 *  label above a left-aligned input reads as a mistake, and long narrative
 *  textareas become unreadable.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync('src/components/legal/LegalCreateWizard.tsx', 'utf8')

/** The component's outermost element — everything the wizard renders. */
const ROOT = /return \(\s*(?:\/\*[\s\S]*?\*\/\s*)?<div className="([^"]+)">\s*<PageHeader/.exec(SRC)

describe('the wizard is a single centred column', () => {
  it('has a root container the whole workflow sits inside', () => {
    expect(ROOT, 'the wizard root moved — this test is now checking nothing').not.toBeNull()
  })

  it('centres that container and caps it at a readable width', () => {
    const cls = ROOT![1]
    expect(cls).toContain('mx-auto')
    expect(cls).toMatch(/max-w-(2xl|3xl|4xl)/)
    // Without w-full the container collapses to its content on narrow screens
    // instead of filling the available width.
    expect(cls).toContain('w-full')
  })

  it('keeps the header, stepper, restore banners and navigation in that one container', () => {
    // The failure this catches: re-introducing a second max-w-* wrapper deeper
    // in the tree, which silently re-creates the ragged layout for whichever
    // pieces sit outside it.
    const inner = SRC.split('<PageHeader')[1] ?? ''
    expect(inner).not.toMatch(/className="[^"]*\bmax-w-3xl\b/)
  })

  it('never centres the text inside the form', () => {
    // Only the container is centred. A centred label above a left-aligned
    // input reads as a bug, and centred narrative text is hard to write in.
    expect(SRC).not.toMatch(/className="[^"]*\btext-center\b/)
  })
})
