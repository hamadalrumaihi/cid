/** Generates src/components/devdocs/handbookContent.ts from docs/handbook/*.md
 *  so the in-app Developer Handbook stays synchronized with the repo docs.
 *  Run `npm run gen:handbook` after editing any docs/handbook file — CI
 *  fails if the generated module drifts from the markdown. */
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'docs/handbook'
const OUT = 'src/components/devdocs/handbookContent.ts'

/** Sidebar structure: section title → md files (order = display order). */
const SECTIONS = [
  { title: 'Getting started', files: ['01-overview.md', '20-learning-path.md'] },
  { title: 'The codebase', files: ['02-repository-tour.md', '03-architecture.md', '06-components.md', 'appendix-file-index.md'] },
  { title: 'Features & pages', files: ['04-features.md', '05-pages.md'] },
  { title: 'Data & API', files: ['07-api.md', '08-database.md', '10-state.md', '11-dependency-map.md'] },
  { title: 'Security & auth', files: ['09-auth.md', '18-security.md'] },
  { title: 'Working on it', files: ['14-development-workflow.md', '15-conventions.md', '16-best-practices.md', '12-change-impact.md', '13-debugging.md', '17-performance.md', '19-improvements.md'] },
  { title: 'Reference', files: ['appendix-glossary.md', 'appendix-quick-reference.md', 'appendix-faq.md'] },
]

const slugOf = (file) =>
  file.replace(/\.md$/, '').replace(/^\d+-/, '').replace(/^appendix-/, '')

const titleOf = (body, file) => {
  const m = body.match(/^#\s+(.+)$/m)
  if (!m) return slugOf(file)
  // "Chapter 9 — Authentication & Permissions" → "Authentication & Permissions"
  return m[1].replace(/^(Chapter \d+|Appendix)\s+—\s+/, '').trim()
}

let updated = 'unknown'
try {
  updated = execSync('git log -1 --format=%cs -- docs/handbook', { encoding: 'utf8' }).trim() || 'unknown'
} catch { /* not a git checkout */ }

const known = new Set(readdirSync(SRC).filter((f) => f.endsWith('.md')))
const listed = new Set(SECTIONS.flatMap((s) => s.files).concat('README.md'))
for (const f of known) if (!listed.has(f)) console.warn(`WARN: ${f} is not in any section — add it to scripts/generate-handbook.mjs`)

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')

const pages = []
for (const section of SECTIONS) {
  for (const file of section.files) {
    const raw = readFileSync(join(SRC, file), 'utf8')
    // Strip the "# title" line and the "[← Handbook index](README.md)" nav line.
    const body = raw
      .replace(/^#\s+.+\n/, '')
      .replace(/^\[← Handbook index\]\(README\.md\)\s*\n/m, '')
      .trim()
    pages.push({ slug: slugOf(file), title: titleOf(raw, file), section: section.title, body })
  }
}

const out = `/** GENERATED from docs/handbook/*.md by scripts/generate-handbook.mjs.
 *  DO NOT EDIT — edit the markdown and run \`npm run gen:handbook\`.
 *  CI verifies this file matches the markdown. */

export interface HandbookPage {
  slug: string
  title: string
  section: string
  body: string
}

export const HANDBOOK_UPDATED = '${updated}'

export const HANDBOOK_PAGES: HandbookPage[] = [
${pages.map((p) => `  {
    slug: ${JSON.stringify(p.slug)},
    title: ${JSON.stringify(p.title)},
    section: ${JSON.stringify(p.section)},
    body: \`${esc(p.body)}\`,
  },`).join('\n')}
]
`
writeFileSync(OUT, out)
console.log(`wrote ${OUT}: ${pages.length} pages, updated ${updated}`)
