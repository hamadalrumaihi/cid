#!/usr/bin/env node
/** A form whose submit button does nothing.
 *
 *  src/components/ui/Button.tsx renders `type={type ?? 'button'}` — a
 *  deliberate default, because most buttons in this app are not submits and an
 *  accidental submit inside a form is its own bug. The consequence is that a
 *  <Button> placed inside <form onSubmit={...}> with no `type="submit"` and no
 *  onClick is completely inert: it is not disabled, it does not error, it
 *  simply does nothing when clicked.
 *
 *  That failure is invisible to every other gate. It typechecks, it lints, it
 *  renders, the visual test screenshots it happily. It shipped three times
 *  before a person tried to click one: the "Restrict Entire Record"
 *  confirmation, the compartment reveal/restrict confirmation, and the whole of
 *  "Ask the library", which had been dead since the day it merged.
 *
 *  So: any <Button> inside a form that has an onSubmit handler must declare
 *  type="submit", or carry its own onClick/onAction. Cancel buttons are the
 *  ordinary case for the latter and pass on their own.
 */
import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'

const files = globSync('src/**/*.tsx')
const bad = []

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  if (!src.includes('onSubmit')) continue

  for (const form of src.matchAll(/<form\b[\s\S]*?<\/form>/g)) {
    const block = form[0]
    if (!block.includes('onSubmit')) continue

    for (const btn of block.matchAll(/<Button\b[^>]*>/g)) {
      const tag = btn[0]
      if (/type="submit"/.test(tag)) continue
      if (/\bonClick\b|\bonAction\b/.test(tag)) continue
      const line = src.slice(0, form.index + btn.index).split('\n').length
      bad.push({ file, line, tag: tag.replace(/\s+/g, ' ').slice(0, 90) })
    }
  }
}

if (bad.length) {
  console.error(`submit-buttons check FAILED (${bad.length} inert button(s)):`)
  for (const b of bad) console.error(`  - ${b.file}:${b.line}  ${b.tag}`)
  console.error(
    '\nA <Button> inside a form with onSubmit needs type="submit" — Button defaults\n' +
    'to type="button", so without it the click does nothing at all. Give it\n' +
    'type="submit", or an explicit onClick/onAction if it is not the submit.')
  process.exit(1)
}

console.log(`submit-buttons OK: ${files.length} components, every form submit is wired`)
