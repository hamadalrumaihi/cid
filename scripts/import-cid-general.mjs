#!/usr/bin/env node

/** One-time, resumable CID General importer.
 *
 * Dry-run is the default. Applying requires both --apply and --yes.
 * The normalized payload is intentionally kept outside git because it contains
 * operational intelligence. Generate it with build-cid-general-import.py.
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const args = new Set(process.argv.slice(2))
const value = (flag) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : null
}
const apply = args.has('--apply')
if (apply && !args.has('--yes')) throw new Error('Refusing to write without --apply --yes')
const payloadPath = resolve(value('--payload') ?? 'imports/cid-general.payload.json')
const reportPath = resolve(value('--report') ?? 'cid-general-import-report.json')
const payload = JSON.parse(await readFile(payloadPath, 'utf8'))
const source = payload.source ?? 'CID General / Gang Fact Sheet'
const normalize = (s) => String(s ?? '').toLowerCase().replace(/\.0\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const nonempty = (v) => v !== null && v !== undefined && String(v).trim() !== ''
const report = { mode: apply ? 'apply' : 'dry-run', source, created: {}, updated: {}, skipped: {}, conflicts: [], errors: [] }
const count = (bucket, key) => { bucket[key] = (bucket[key] ?? 0) + 1 }

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the shell; never commit them.')
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const selectAll = async (table) => {
  const { data, error } = await db.from(table).select('*')
  if (error) throw error
  return data ?? []
}
const insert = async (table, row) => {
  if (!apply) return { id: `dry-${table}-${Math.random()}` }
  const { data, error } = await db.from(table).insert(row).select().single()
  if (error) throw error
  return data
}
const patchMissing = async (table, current, incoming, fields) => {
  const patch = {}
  for (const field of fields) {
    if (!nonempty(current[field]) && nonempty(incoming[field])) patch[field] = incoming[field]
    else if (nonempty(current[field]) && nonempty(incoming[field]) && normalize(current[field]) !== normalize(incoming[field])) {
      report.conflicts.push({ table, id: current.id, field, kept: current[field], workbook: incoming[field] })
    }
  }
  if (!Object.keys(patch).length) return false
  if (apply) {
    const { error } = await db.from(table).update(patch).eq('id', current.id)
    if (error) throw error
  }
  return true
}

const [gangRows, memberRows, turfRows, placeRows, mediaRows] = await Promise.all(
  ['gangs', 'gang_members', 'gang_turf', 'places', 'media'].map(selectAll),
)
const gangByName = new Map(gangRows.map((r) => [normalize(r.name), r]))
const gangIds = new Map()

for (const incoming of payload.gangs ?? []) {
  try {
    const keys = [incoming.name, ...(incoming.aliases_list ?? [])].map(normalize).filter(Boolean)
    const matches = [...new Set(keys.map((k) => gangByName.get(k)).filter(Boolean))]
    if (matches.length > 1) { report.conflicts.push({ table: 'gangs', incoming: incoming.name, reason: 'multiple name/alias matches', ids: matches.map((x) => x.id) }); continue }
    let row = matches[0]
    const values = { name: incoming.name, aliases: incoming.aliases ?? null, colors: incoming.colors ?? null, classification: incoming.classification ?? null, threat_level: incoming.threat_level ?? 'low', status: incoming.status ?? 'active', confidence: incoming.confidence ?? 'unverified', notes: incoming.notes ?? null }
    if (!row) { row = await insert('gangs', values); count(report.created, 'gangs'); gangByName.set(normalize(values.name), row) }
    else if (await patchMissing('gangs', row, values, ['aliases', 'colors', 'classification', 'status', 'confidence', 'notes'])) count(report.updated, 'gangs')
    else count(report.skipped, 'gangs')
    gangIds.set(incoming.source_key, row.id)
  } catch (error) { report.errors.push({ table: 'gangs', incoming: incoming.name, error: error.message }) }
}

for (const incoming of payload.members ?? []) {
  try {
    const gang_id = gangIds.get(incoming.gang_key); if (!gang_id) { count(report.skipped, 'members_missing_gang'); continue }
    const row = memberRows.find((r) => r.gang_id === gang_id && normalize(r.name) === normalize(incoming.name))
    const values = { gang_id, name: incoming.name, rank: incoming.rank ?? null, note: incoming.note ?? null, mugshot_url: incoming.mugshot_url ?? null, confidence: incoming.confidence ?? 'unverified', provenance: source, status: 'active', ccw: incoming.ccw ?? null, vch: incoming.vch ?? null }
    if (!row) { await insert('gang_members', values); count(report.created, 'gang_members') }
    else if (await patchMissing('gang_members', row, values, ['rank', 'note', 'mugshot_url', 'confidence', 'provenance'])) count(report.updated, 'gang_members')
    else count(report.skipped, 'gang_members')
  } catch (error) { report.errors.push({ table: 'gang_members', incoming: incoming.name, error: error.message }) }
}

for (const incoming of payload.turf ?? []) {
  try {
    const gang_id = gangIds.get(incoming.gang_key); if (!gang_id) { count(report.skipped, 'turf_missing_gang'); continue }
    const row = turfRows.find((r) => r.gang_id === gang_id && normalize(r.block) === normalize(incoming.block))
    if (!row) { await insert('gang_turf', { gang_id, block: incoming.block, hotspot_area: incoming.area ?? null, confidence: incoming.confidence ?? 'unverified', notes: `Imported from ${source}`, status: 'active' }); count(report.created, 'gang_turf') }
    else count(report.skipped, 'gang_turf')
  } catch (error) { report.errors.push({ table: 'gang_turf', incoming: incoming.block, error: error.message }) }
}

const placeBySource = new Map()
for (const incoming of payload.places ?? []) {
  try {
    const row = placeRows.find((r) => normalize(r.name) === normalize(incoming.name) && normalize(r.area) === normalize(incoming.area))
    const values = { name: incoming.name, area: incoming.area ?? null, type: incoming.type, notes: incoming.notes ?? `Imported from ${source}` }
    let saved = row
    if (!saved) { saved = await insert('places', values); count(report.created, 'places') }
    else if (await patchMissing('places', saved, values, ['area', 'notes'])) count(report.updated, 'places')
    else count(report.skipped, 'places')
    placeBySource.set(incoming.source_key, saved.id)
  } catch (error) { report.errors.push({ table: 'places', incoming: incoming.name, error: error.message }) }
}

const uploadFiveManage = async (path) => {
  const apiKey = process.env.FIVEMANAGE_API_KEY
  if (!apiKey) throw new Error('FIVEMANAGE_API_KEY is required to apply media uploads')
  const bytes = await readFile(path)
  const form = new FormData()
  form.append('image', new Blob([bytes]), basename(path))
  form.append('metadata', JSON.stringify({ name: basename(path), source }))
  const base = (process.env.FIVEMANAGE_BASE_URL ?? 'https://api.fivemanage.com').replace(/\/+$/, '')
  const response = await fetch(`${base}/api/image`, { method: 'POST', headers: { Authorization: apiKey }, body: form })
  if (!response.ok) throw new Error(`FiveManage HTTP ${response.status}`)
  const body = await response.json()
  const result = body.url || body.link || body.data?.url
  if (!result) throw new Error('FiveManage returned no URL')
  return result
}

for (const incoming of payload.media ?? []) {
  try {
    const path = resolve(dirname(payloadPath), incoming.file)
    const sha256 = incoming.sha256 ?? createHash('sha256').update(await readFile(path)).digest('hex')
    const exists = mediaRows.some((r) => r.tags?.source_sha256 === sha256)
    if (exists) { count(report.skipped, 'media'); continue }
    const external_url = apply ? await uploadFiveManage(path) : `dry-run://${basename(path)}`
    await insert('media', { title: incoming.title, type: 'image', kind: 'Image URL', external_url, gang_id: gangIds.get(incoming.gang_key) ?? null, place_id: placeBySource.get(incoming.place_key) ?? null, category: incoming.category ?? 'other', tags: { labels: incoming.labels ?? ['CID General import'], source, source_sheet: incoming.sheet, source_anchor: incoming.anchor, source_sha256: sha256, verification: incoming.confidence ?? 'unverified' } })
    count(report.created, 'media')
  } catch (error) { report.errors.push({ table: 'media', incoming: incoming.title, error: error.message }) }
}

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
if (report.errors.length) process.exitCode = 1
