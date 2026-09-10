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
const CATEGORIES = new Set(['assignments', 'decisions', 'legal', 'mentions', 'escalations', 'intel', 'reports', 'announcements', 'security', 'other'])
const bad = Object.entries(parsed).filter(([, v]) =>
  !v || typeof v.title !== 'string' || !v.title.trim() || !CATEGORIES.has(v.category))
if (bad.length) {
  console.error(`sync-notification-titles: every entry needs {title, category ∈ ${[...CATEGORIES].join('|')}} — bad: ${bad.map(([k]) => k).join(', ')}`)
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
