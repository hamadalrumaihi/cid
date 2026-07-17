# CID Portal — Fix Verification (2026-07-02)

## Verdict

The 45 fixes are largely solid. 57 of 45 targeted changes were confirmed applied and correct (the pass fixed a broader set than originally scoped, including full sibling-sink coverage for the SET-NULL-on-stale-cache and `safeUrl()` families). However, the pass is **not complete**: adversarial adjudication upheld five genuinely-open problems, and an under-covered sweep surfaced four additional defects the fix pass never touched. The most serious gap is a data-loss defect — `openMemberModal`'s `person_id` picker in `gangs.js` was left out of the same stale-cache guard applied to every other FK sink, so it silently severs the roster→person link on any edit while `PERSONS` is empty. Two data-loss inconsistencies (place modal delete bypassing undo, inbox overdue metric) and a cluster of member-supplied `src`/CSV sinks (`personnel.js`, `records.js`, `drive.js`) also remain. None are critical (no XSS/RCE/bureau-isolation break confirmed), but the medium-severity data-loss items should be closed before this pass is called done.

## Confirmed fixed (57/45)

57 of the 45 in-scope fixes verified applied and correct. Notably the carried-FK-option guard was applied across the full sibling set — `persons.js:137-140` (gang_id), `vehicles.js:73-78` (owner_id/gang_id), and the `case_id` picker at `gangs.js:178-180` — and the gang-detail Delete was routed through `deleteWithUndo` with children/setNullRefs. The `safeUrl()` hardening landed in `persons.js` and `gangs.js` member cards.

## Still open / incomplete

1. **`gangs.js:173` — `openMemberModal` `person_id` picker nulls the person link on stale `PERSONS` cache** (medium, data-loss; upheld). This is the unaddressed half of finding `persons.js:135`. `personOpts` is still built from raw `PERSONS.map(...)` with only a `''` placeholder — no carried/preserved option — while every other sink in the same family (including the `case_id` picker in the *same modal*) got the guard. When `PERSONS` is empty (fetch in flight, or `persons.js:67` swallowed a load error leaving `PERSONS=[]`), the select renders the blank placeholder and the save handler at `gangs.js:203` (`if(!payload.person_id) payload.person_id=null`) silently severs the roster→person link on any unrelated edit. RLS (`gang_members_upd = is_active`) does not block it. **Fix:** carry a `(current person — loading…)` option for the member's existing `person_id`, mirroring `persons.js:137-140`.

2. **`places.js:125` — edit-modal Delete (`#pl-del2`) bypasses `deleteWithUndo`** (low, data-loss; upheld). The card delete (`places.js:70`) and bulk delete (`places.js:40`) both route through `deleteWithUndo` with `children:[place_process_steps]`, but the modal delete calls `DB().remove('places', p.id)` directly. Schema confirms the cascade is real (`20260616090000_platform.sql:227`, `place_id ... on delete cascade`), so a mistaken modal delete cascade-wipes production process steps with no 6s undo and no child snapshot — the identical class the audit fixed for gangs. **Fix:** route `#pl-del2` through `deleteWithUndo` with `children:[{table:'place_process_steps',column:'place_id'}]`.

3. **`command.js:107` — attention-widget `all →` deep-link ignores `casesScope`** (low, UX correctness; upheld). The `att-all` handler (lines 102-113) reassigns `caseFilters` with `assignee:'unassigned'`/`stale:'stale'` and navigates to Cases but never sets `casesScope`. Default scope is `'mine'` (`casefiles.js:29`); `renderCases` applies `items.filter(c => c.lead_detective_id === me)` at `casefiles.js:392` *before* `applyCaseFilters` (line 393). The two filters intersect to the empty set, so a default-scope user clicking `all →` on 'No lead detective (>5)' lands on an empty Cases list; 'Stale all →' shows only the viewer's own subset, not the bureau-wide list the widget displayed. **Fix:** set and persist `casesScope='all'` in the handler.

(Findings 1 and the `persons.js:135` "incomplete" flag describe the same single open sink — counted once above.)

## New defects found (from the sweep)

1. **`inbox.js:22` — Overdue age measured from `signoff_submitted_at`, never reset on movement** (medium, metric correctness). `inboxAge` is unchanged from pre-fix `5099e30`: `inboxDaysSince(c.signoff_submitted_at || c.updated_at || c.created_at)`. The inbox diff only added `status!=='closed'/'cold'` guards (lines 57/126) — a different finding. An OPEN, actively-worked case (`updated_at`=yesterday) with a 15-day-old `signoff_submitted_at` still reports "15d overdue", sorts to top, inflates counters, and lands in `myOverdue`. **Fix:** measure age from `updated_at`.

2. **`records.js:94` — mugshot `<img src>` without `safeUrl()`** (low). Still emits `<img src="${esc(r.mugshot_url)}">`; the `persons.js:109` fix added `safeUrl()` to `persons.js`/`gangs.js` member cards but this member-supplied `mugshot_url` sink (critic named `records.js:90`) was not updated. Family fix incomplete.

3. **`personnel.js:97` — media `src` without `safeUrl()`** (low). `mediaThumb` (line 97) and the lightbox video/audio branches (lines 174-175) emit `<img/video/audio src="${esc(src)}">` with `esc()` only; only the iframe branch uses `safeUrl()`. `src` is member-supplied `external_url`/`storage_path`. `personnel.js` had zero changes; permits `data:`/`blob:` scheme smuggling.

4. **`drive.js:197` — CSV formula injection** (low). `downloadCsv` quoter is still `'"'+String(v==null?'':v).replace(/"/g,'""')+'"'` with no guard for leading `=,+,-,@`. Sheet cells are member-authored and exported verbatim, so member A can plant `=HYPERLINK`/DDE payloads that fire when member B opens the CSV in Excel. `drive.js` has zero changes in the diff.

## DB / migration verification result

Schema checks corroborate the code findings. Migration `20260616090000_platform.sql:227` confirms `place_process_steps.place_id ... references public.places on delete cascade`, making the `places.js:125` modal delete a genuine cascade data-loss path. RLS policy `gang_members_upd = is_active` permits the `gangs.js:203` person_id null-out, so the server does not backstop the client-side stale-cache defect. No migration-level regressions were introduced by the fix pass; the open items are all client-side.

## Resolution status (fixed 2026-07-05)

All 7 distinct open items from this verification pass are now resolved:

1. **gangs.js — `openMemberModal` person_id picker** — FIXED. Carried `(linked person — loading…)` option added for the member's existing `person_id`, mirroring the `case_id` picker and `persons.js`. No longer nulls the roster→person link on a stale/empty `PERSONS` cache.
2. **places.js — edit-modal Delete (`#pl-del2`)** — FIXED. Routed through `deleteWithUndo` with `children:[place_process_steps]`; the cascade is now restorable, matching the card and bulk delete paths.
3. **command.js — attention-widget `all →` scope** — FIXED. Handler now sets and persists `casesScope='all'` before navigating, so the unassigned/stale lists render bureau-wide instead of intersecting to empty under the default `mine` scope.
4. **inbox.js — overdue age metric** — FIXED. `inboxAge` now measures from `signoff_submitted_at` only while a case is awaiting a reviewer; otherwise from `updated_at`, so an actively-worked case is no longer mislabelled overdue by a stale submission date.
5. **records.js — mugshot `<img src>`** — FIXED. Wrapped in `safeUrl()`.
6. **personnel.js — media `src` (thumb + lightbox image/video/audio)** — FIXED. All four sinks wrapped in `safeUrl()`; only the already-guarded iframe/anchor were compliant before.
7. **drive.js — CSV formula injection** — FIXED. `downloadCsv` cell quoter now prefixes `'` to any value starting with `= + - @` or a control char, neutralizing spreadsheet formula/DDE payloads.

Verification: all files + concatenated bundle parse clean; headless smoke test shows zero app JS errors; `inboxAge` and the CSV guard unit-checked on edge inputs.
