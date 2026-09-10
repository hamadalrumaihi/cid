#!/usr/bin/env node
/** Notification titles sync (Phase 7, P7-07) — ONE source of truth.
 *
 *  `src/lib/notificationTitles.json` is the map the app renders
 *  (lib/notifText NOTIF_LABEL + the Discord category per type). The
 *  discord-notify Edge Function cannot import from src/, so it ships its own
 *  copy at `supabase/functions/discord-notify/titles.json`. This script copies
 *  the source over the copy; `--check` (the `check:notif-titles` gate) fails
 *  when the two differ so a title added on one side can never drift. */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Resolve from the script's own location, not the cwd — the gate must behave
// the same from a hook, a CI step or a nested shell.
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC_REL = 'src/lib/notificationTitles.json'
const DEST_REL = 'supabase/functions/discord-notify/titles.json'
const SRC = new URL(SRC_REL, `file://${ROOT}`)
const DEST = new URL(DEST_REL, `file://${ROOT}`)
const check = process.argv.includes('--check')

const src = readFileSync(SRC, 'utf8')
let parsed
try { parsed = JSON.parse(src) } catch (e) {
  console.error(`sync-notification-titles: ${SRC_REL} is not valid JSON — ${e.message}`)
  process.exit(1)
}
/** Entry shape: { title, category, destination?: 'portal', mutable?: true,
 *  priority?: 'high'|'normal'|'low' } — mirrored by lib/notifText NotifEntry.
 *  `informants` kinds are portal-only by contract (never DM'd), so every entry
 *  in that category must carry destination 'portal'. */
const CATEGORIES = new Set(['assignments', 'decisions', 'legal', 'mentions', 'escalations', 'intel', 'reports', 'announcements', 'security', 'informants', 'other'])
const FIELDS = new Set(['title', 'category', 'destination', 'mutable', 'priority'])
const PRIORITIES = new Set(['high', 'normal', 'low'])
const problems = []
for (const [k, v] of Object.entries(parsed)) {
  if (!v || typeof v !== 'object') { problems.push(`${k}: not an object`); continue }
  if (typeof v.title !== 'string' || !v.title.trim()) problems.push(`${k}: title must be a non-empty string`)
  if (!CATEGORIES.has(v.category)) problems.push(`${k}: category must be one of ${[...CATEGORIES].join('|')}`)
  for (const f of Object.keys(v)) if (!FIELDS.has(f)) problems.push(`${k}: unknown field "${f}"`)
  if ('destination' in v && v.destination !== 'portal') problems.push(`${k}: destination may only be "portal"`)
  if ('mutable' in v && v.mutable !== true) problems.push(`${k}: mutable may only be true (omit it otherwise)`)
  if ('priority' in v && !PRIORITIES.has(v.priority)) problems.push(`${k}: priority must be high|normal|low`)
  if (v.category === 'informants' && v.destination !== 'portal') problems.push(`${k}: informants kinds must be destination "portal"`)
  if (v.mutable === true && v.destination === 'portal') problems.push(`${k}: a portal-only kind is not mutable`)
}
if (problems.length) {
  console.error(`sync-notification-titles: invalid entries —\n  ${problems.join('\n  ')}`)
  process.exit(1)
}

let dest = null
try { dest = readFileSync(DEST, 'utf8') } catch { /* missing copy */ }

if (check) {
  if (dest !== src) {
    console.error(`sync-notification-titles: ${DEST_REL} is out of date — run \`node scripts/sync-notification-titles.mjs\``)
    process.exit(1)
  }
  console.log(`sync-notification-titles: ${Object.keys(parsed).length} titles in sync`)
} else {
  writeFileSync(DEST, src)
  console.log(`sync-notification-titles: wrote ${DEST_REL} (${Object.keys(parsed).length} titles)`)
}
