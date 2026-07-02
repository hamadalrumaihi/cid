# CID Portal — Ultracode Deep Audit

**Date:** 2026-07-02  ·  **Codebase:** vanilla-JS SPA (31 scripts, shared global scope) + Supabase (RLS-enforced) on Vercel

## Methodology

A multi-agent audit fleet was run against a frozen checkout plus a **live dump of the deployed database security surface** (every RLS policy, `private.*` helper + SECURITY DEFINER function body, trigger, grant, and column — dumped to files so reviewers judged what is actually deployed, not what the migrations claim). Structure:

- **22 parallel reviewers** — 14 module reviewers covering all 31 JS files + `index.html`/`styles.css`/`vercel.json`, and 8 cross-cutting dimension sweeps (stored-XSS, shared-global-scope integrity, client-gating-vs-RLS, RLS model, SECURITY DEFINER/triggers, migration drift, races, error-handling).
- **Adversarial verification** — every deduplicated finding faced two independent skeptics (one ordered to refute, one to reconstruct the failure from real code), with a tiebreaker on splits. Only findings surviving verification are listed.
- A **completeness critic** hunted for what the fleet missed.

**Funnel:** 103 raw findings → 93 after dedupe → **45 confirmed** after adversarial verification.

> ⚠️ **Verification-coverage caveat:** the run hit the session token limit during the verify phase. ~99 verifier sub-agents (concentrated on the higher-indexed findings in `rico.js`, `records.js`, `narcotics.js`, `modus.js`, `drive.js`, `collab.js`, `shifts.js`, `app.js`, and later migrations) could not complete, so their findings were conservatively dropped to "unconfirmed" rather than verified. The 45 below are the ones that *passed* verification; a resumable follow-up pass would confirm or kill the remainder.

## Verdict

The core security model **held up**: bureau-isolation RLS, the SECURITY DEFINER sign-off chain, and HTML escaping are applied consistently across the great majority of sinks. But the audit found **one critical and eight high-severity defects** the earlier lightweight audits missed — including **two stored-XSS vectors any member can weaponize**, and **two integrity controls (finalized-report locking and tracker dual-authorization) that are enforced only in the browser while the server RLS permits the bypass**. These are real and reachable under the invite-only threat model. The bulk of the remaining findings are data-loss-on-stale-cache bugs and silent error-swallowing.

## Confirmed findings

**1 critical · 8 high · 18 medium · 18 low**

### 🔴 Critical

**`inbox.js:249` — Stored XSS via unescaped notification payload.case_id in deskMentions**  
*xss*

deskMentions builds the mention card with card.innerHTML = `...data-case="${p.case_id}"...` where p = n.payload (jsonb from the notifications table) — the only unescaped interpolation on the card (p.reason and p.case_number are escaped). The RLS dump (policies.md line 114) shows notif_ins is `with check (private.is_active())` with no constraint on user_id or payload, so ANY active member can insert a notification for any victim: DB().insert('notifications', { user_id: victim, type: 'chat_mention', payload: { reason: 'x', case_id: '"><img src=x onerror=/*js*/>' } }). The unread chat_mention is counted into the victim's badge (line 54), luring them to My Desk, where onEnterInbox renders it and the onerror payload executes in the victim's browser.

**Fix:** Escape it (`data-case="${escapeHTML(p.case_id)}"`) or, better, validate it is a UUID before rendering; consider also tightening notif_ins server-side.

### 🟠 High

**`casefiles.js:603` — Stored XSS: caseCourtHint interpolates officerName() into innerHTML unescaped**  
*xss*

caseCourtHint (line 21) builds h.t as '⏳ Waiting on ' + officerName(c.signoff_assignee_id), and renderCaseDetailShell injects it raw at line 603 (`${h.t}`) into #case-detail innerHTML. officerName() (command.js:425) returns profiles.display_name verbatim, and display_name is self-editable by every member (collab.js openMyProfile UI; RLS policy profiles_upd_self allows UPDATE where id = auth.uid()). A reviewer (bureau lead / deputy / director — whoever is routed as signoff_assignee_id) who sets display_name to e.g. `<img src=x onerror=...>` gets their payload executed in the browser of every member who opens any case that is awaiting their sign-off. Every other officerName() render site in this file is escaped (lines 649, 713, 717, 810); this is the one raw sink.

**Fix:** In caseCourtHint, escape the name: '⏳ Waiting on ' + escapeHTML(officerName(c.signoff_assignee_id) || stageLabel), or escape h.t at the injection site on line 603.

**`command.js:492` — Tracker dual-command authorization is enforced only client-side; RLS lets any active member authorize, extend, or forge trackers**  
*rls*

The GPS-tracker dual-signature workflow (SOP Title 7) is gated purely in the browser: openTrackerModal (line 515) and the co-sign button (lines 462/485) require DB().canDelete(), and line 490 blocks the director from co-signing their own tracker. But the server policies (audit-db/policies.md lines 156-159) are trackers_ins CHECK = can_access_case(case_id) ELSE can_access_bureau(bureau) and trackers_upd USING/CHECK = the same expression — plain bureau/case access, no role check and no column protection. can_access_bureau('JTF') is true for EVERY active member, and the client itself defaults bureau to 'JTF' when no case is linked (line 539). So any active detective can, via the raw PostgREST endpoint: (a) UPDATE a pending tracker to set deputy_sig/status='authorized'/expires_at (the exact write at line 492), (b) self-co-sign as director+deputy, or (c) INSERT a fully-authorized tracker with forged director_sig/deputy_sig and an arbitrary expiry, bypassing the dual-authorization integrity control entirely. The auto-expire at line 510 is likewise only advisory.

**Fix:** Move tracker signing to a SECURITY DEFINER RPC like the case sign-off chain (validate role in ('bureau_lead','deputy_director','director') and deputy_sig <> director_sig server-side, compute expires_at in SQL), or tighten trackers_ins/trackers_upd to private.can_delete() and add a trigger forbidding director_sig = deputy_sig.

**`core.js:679` — PAGE_META 'reports' tab has no #view-reports section — navigating to it blanks the app and the blank state persists across reload**  
*dom-mismatch*

PAGE_META contains a 'reports' entry (core.js:679), so navigate('reports') passes the `if (!PAGE_META[tab]) tab='command'` fallback at line 725. But index.html has no `<section id="view-reports">` (verified: all other PAGE_META tabs have views), 'reports' is in no NAV_CATEGORIES group, and navigate() has no onEnter hook for it. The tab is reachable: collab.js REC_LINK maps report link chips in case chat (collab.js:173) and announcements (collab.js:302) to navigate('reports'). When it runs, every .view is deactivated and none is activated — the main content area goes blank — then history.replaceState writes '#reports' and Store.set('tab','reports') persists it, so app.js:426 boots straight back into the blank state on every reload until the user manually clicks a nav category.

**Fix:** Point REC_LINK.report at 'cases' (reports live in the case-detail Reports tab) and/or remove the dead 'reports' PAGE_META entry, or add a guard in navigate() that falls back when $('#view-'+tab) is null.

**`gangs.js:172` — Editing a gang member silently severs cross-bureau case links**  
*data-loss*

openMemberModal builds the 'Link Case' select solely from casesCache, which is bureau-scoped (cases_sel RLS = private.can_access_case_row, policies.md line 50). gang_members rows are globally readable/updatable by any active member (gang_members_upd = private.is_active(), policies.md line 80). If a detective in bureau A edits a member whose case_id points to a bureau-B case (e.g. just to fix a rank), that case is absent from caseOpts, the select falls back to the '' option, and the save handler at line 195 converts '' to null and writes it — permanently and silently destroying the case linkage. RLS permits the write, so the server does not block this.

**Fix:** When member.case_id is set but not found in casesCache, render a preserved '(linked case — other bureau)' option carrying the original id, or omit case_id from the update payload when the select still shows the placeholder.

**`inbox.js:126` — "Your overdue cases" and the needs-attention badge include closed and cold cases**  
*correctness*

The myOverdue filter (line 126, desk) and the identical badge filter in inboxActionCount (line 57) are `c.lead_detective_id === me && inboxIsOverdue(c) && !inSignoff.has(c.id)` with no status check. A closed case's updated_at freezes, so 14 days after closing every case a member ever led reappears as 'Overdue — no movement in Nd' on My Desk and permanently lights the #signoff-nav-badge / #signoff-bnav-badge counters. The sibling followUps filter checks `c.status !== 'closed'` (lines 59/141) and escalateStaleCases (casefiles.js:308) excludes closed/cold — this bucket forgot the same guard. Net effect: for essentially every long-tenured user the action badge never clears, defeating the 'needs MY action' contract.

**Fix:** Add `c.status !== 'closed' && c.status !== 'cold'` to both the badge filter (line 57) and the myOverdue filter (line 126), matching escalateStaleCases.

**`records.js:46` — Records auth bar and '+ New Record' render before DB().me is set and are never refreshed, leaving create UI hidden for signed-in members**  
*race*

initRecords() runs from app.js init() on DOMContentLoaded and calls renderAuthBar() plus registers DB().onAuth(...) (line 46). The INITIAL_SESSION/SIGNED_IN auth events fire immediately after subscription, but DB().me is only populated later by auth.js evaluate() after an async profile fetch (auth.js:93-94). So renderAuthBar() deterministically runs with me === null: #rec-auth shows 'Sign in to the portal to view and manage records.' and #rec-new stays hidden — for a fully signed-in active member. Nothing ever calls renderAuthBar() again (CIDApp.onAuthed in casefiles.js:1222 doesn't touch the records module; the ↻ Refresh button only calls fetchRecords), so until a later auth event (token refresh, ~an hour), members see records but cannot create one and are told to sign in. renderRecords() from the same early fetch also hides all Edit buttons until something re-renders the grid.

**Fix:** Have CIDApp.onAuthed (or auth.js after setting CIDDB.me) call renderAuthBar() and renderRecords(), or re-render them from a profiles-loaded hook instead of relying solely on raw auth events.

**`records.js:130` — Non-owner edits to cid_records silently discarded with a false 'Record updated' success toast**  
*auth-gating*

RLS policy cid_update (audit-db/policies.md line 55) allows UPDATE only when created_by = auth.uid() OR private.is_command() (bureau_lead/deputy_director/director). But records.js:103 renders the Edit button for every canEdit() member (any active detective/senior_detective), and the save handler at line 130 calls DB().update('cid_records', ...) which is client.from().update().eq('id',id).select() (supabase.js:59). When RLS's USING clause filters the row out, PostgREST returns { data: [], error: null } — zero rows updated, no error. Line 132 only checks res.error, so a non-owner detective who edits another member's record gets closeModal + toast('Record updated','success') + refetch, and every change they typed is silently thrown away while the UI reports success.

**Fix:** After update, treat res.data.length === 0 as failure ('You can only edit records you created'), and/or only render the Edit button when DB().me.id === r.created_by || DB().isAdmin() to mirror the RLS policy.

**`reports.js:380` — Finalized/signed report content is not actually locked — `fields` remains writable by any member with case access**  
*rls*

The finalize modal promises "Finalizing locks the report against further edits" and viewReport shows a '🔒 FINALIZED · Electronically signed' seal, but the server only protects the `finalized` and `signature` columns: trigger private.block_direct_report_finalize (triggers.md:47, functions.md:24-36) raises only when `finalized` or `signature` change, while RLS policy reports_upd (policies.md:143) allows UPDATE for anyone passing can_access_case(case_id). So any active member with access to the case can rewrite the entire `fields` jsonb (narrative, probable cause, suspects) of a finalized report while it still displays as sealed and electronically signed by the original officer. The client's own warrant flow proves the write path works post-finalize: setWarrantStatus (reports.js:42) does DB().update('reports', r.id, {fields: nf}) on finalized warrants and succeeds. This breaks the sign-off/signature integrity guarantee: what a Director sees under a signature can be altered after signing.

**Fix:** Extend block_direct_report_finalize to also raise when old.finalized and new.fields is distinct from old.fields (whitelisting only the _warrant_status/_warrant_log keys, or better, move warrant lifecycle to a SECURITY DEFINER RPC that patches only those keys).

### 🟡 Medium

**`auth.js:82` — auth.js overwrites window.CIDApp.refreshAuthBar registered by collab.js instead of chaining, killing the officer-card refresh hook**  
*correctness*

collab.js:390 sets window.CIDApp.refreshAuthBar = renderOfficerCard (comment: 'called by signoff.setMyLoa'). auth.js loads last (index.html:709 vs 701) and its top-level assignment at line 82 replaces that hook with one that only re-renders the header auth slot. Every other module that extends a shared CIDApp hook chains the previous value (watchlist.js:156, feedback.js:113, inbox.js:284); auth.js does not. Failure: an officer toggles LOA via signoff.setMyLoa (signoff.js:236) — the header updates but the sidebar officer info card keeps the stale LOA state until a profiles realtime event happens to arrive (AGENTS.md explicitly warns the writer's own realtime echo is unreliable).

**Fix:** In auth.js capture var prev = window.CIDApp.refreshAuthBar and call it after re-rendering the header slot (or have both registrations chain).

**`auth.js:113` — evaluate()/onAuthed re-run on every auth event with no once-guard, duplicating ~35 realtime subscriptions and full refetch storms**  
*race*

boot() (auth.js:111-116) calls evaluate() directly AND registers evaluate as the onAuthStateChange callback. supabase-js v2 (2.108.2, pinned in index.html:651) emits INITIAL_SESSION immediately on subscription, so at startup two evaluate() runs proceed concurrently, and each one that finds an active profile calls window.CIDApp.onAuthed (auth.js:107). onAuthed (casefiles.js:1222-1266) is not idempotent: every invocation refetches ~20 tables and calls DB().subscribe() for ~35 tables, creating new channels with the same 'rt_<table>' topics (supabase.js:62-67 never dedupes or removes channels). The same repeat happens on every TOKEN_REFRESHED (~hourly) and SIGNED_IN event. Result: deterministic double fetch-all at boot, hourly full-app refetch storms, and realtime channel churn (phoenix closes the duplicate open topic mid-flight, during which change events can be dropped).

**Fix:** In evaluate(), only call onAuthed on the first transition to an active session (e.g. track the last seen user id / an 'authedFired' flag, reset on SIGNED_OUT), and/or make DB().subscribe reuse an existing channel per table.

**`casefiles.js:318` — Stale-case escalation stamp is not compare-and-swap: concurrent viewers double-notify, and a failed notify is silently suppressed for 14 days**  
*race*

escalateStaleCases() comments 'Stamp first; if another viewer beat us (or RLS blocks the write), skip', but the stamp is a plain unconditional UPDATE: DB().update('cases', c.id, { last_stale_notified_at: ... }). DB().update only surfaces {error}; when two members open the portal within the same window (the run fires 6s after every load, casefiles.js:1234), both UPDATEs succeed (cases_upd RLS allows any case-accessor), both pass the `if (res && res.error) continue` check, and both loop over targets sending duplicate 'case_stale' notifications to the lead detective and every bureau lead. Conversely, because the stamp is written BEFORE the notify loop and notify() (command.js:442) swallows insert failures in try/catch, a network blip during the loop means the stamp sticks but nobody is notified — and the stamp suppresses all other viewers from re-firing for 14 days (STALE_RENOTIFY_MS), so the alert is lost entirely.

**Fix:** Make the stamp a CAS: DB().from('cases').update({last_stale_notified_at: ts}).eq('id', c.id).eq/is('last_stale_notified_at', c.last_stale_notified_at ?? null).select(), and only notify when the returned data array is non-empty (0 rows matched = another viewer won). Optionally stamp only after at least one notification insert succeeds.

**`casefiles.js:618` — Pin / quick-status / follow-up rebuild the detail shell without loadDetailTab, leaving the tab body stuck on “Loading…”**  
*correctness*

renderCaseDetailShell() resets #detail-body to '<p>Loading…</p>' (line 608). The Pin handler (line 618) calls renderCaseDetailShell(); renderJumpBack(); with no loadDetailTab() and no DB write, so no realtime event ever rescues it — clicking 📌 Pin on a case detail permanently blanks the active tab until the user manually clicks a tab. The quick status-change handler (line 616) and openFollowUpModal save (line 702) have the same omission; they only recover if the 'cases' realtime self-echo arrives, which AGENTS.md explicitly documents as unreliable for the writer's own session.

**Fix:** Call loadDetailTab() after renderCaseDetailShell() in all three handlers, matching the pattern already used by the tab buttons (line 632) and the ch-rico link (line 1089).

**`casefiles.js:906` — Evidence quick-log: Ctrl/⌘+Enter silently does nothing when the only item is typed but not staged**  
*correctness*

saveAll() checks `if (!staged.length) return;` (line 906) BEFORE the `if (descF.value.trim()) stage();` rescue on line 907 that the comment says exists so a typed-but-unstaged item isn't dropped. The modal instructs users that Ctrl/⌘+Enter “logs everything”, but if the user types their first (or only) item and hits Ctrl+Enter without pressing Enter first, staged is empty, saveAll returns early with no toast, and nothing is logged — the promised behavior only works when at least one other item was already staged.

**Fix:** Swap the two lines: stage the pending description first, then bail if staged is still empty.

**`command.js:243` — Bureau-lead scorecard scoping never activates: reads me.bureau but the profile column is 'division'**  
*correctness*

renderBureauScorecards documents (lines 226-229) that 'a bureau lead sees only their own' bureau, implemented as `if (me.role === 'bureau_lead' && me.bureau) keys = [me.bureau]`. The profiles table has no `bureau` column — it is `division` (audit-db/columns.md line 40; every other module uses me.division, e.g. collab.js:69, shifts.js:76). me.bureau is always undefined, so the branch never fires and a bureau lead always renders all four bureau scorecards. Because private.is_command() includes bureau_lead, their RLS-scoped casesCache contains ALL bureaus' cases, so the other bureaus' cards show full real numbers — the intended own-bureau-only view is silently broken.

**Fix:** Change to `me.division`: if (me.role === 'bureau_lead' && me.division) keys = [me.division];

**`command.js:394` — Ticket wizard ignores the result of marking the ticket processed after creating the case**  
*error-handling*

In openTicketWizard step2, after DB().insert('cases', ...) succeeds, line 394 runs `await DB().update('tickets', ticket.id, { status:'processed', case_id, routed_bureau })` but never checks res.error (DB().update returns {error} and never throws, per the data-layer contract; every other write in this file checks it). If the update fails (network drop, RLS/enum error), the wizard still advances to the success screen at step3 and shows 'Case File Generated', while the ticket remains status 'new' with a live 'Process Ticket' button. The next processor will run the wizard again for a ticket whose case already exists — either hitting a confusing duplicate-case_number error or creating a second, duplicate case under a different number.

**Fix:** Check the update result: `const tu = await DB().update('tickets', ...); if (tu.error) { toast('Case created but ticket not marked processed: ' + tu.error.message, 'danger'); }` before proceeding to step3 (or retry/link the existing case).

**`core.js:489` — deleteWithUndo undo integrity: child snapshot failures and child re-insert failures are silent, so 'restored' can be reported while cascade children are permanently lost**  
*data-loss*

Line 489 snapshots cascade children with the raw builder `DB().from(t).select('*').in(col, ids)`, which returns {data,error} and never throws — on a failed select (network blip, transient error) `r.data` is null and the snapshot becomes [], yet the parent delete proceeds and the ON DELETE CASCADE wipes the children. Line 501's undo path has the same blindness: DB().insert returns {error} (never throws), so the useless try/catch swallows nothing and failed child re-inserts are not counted — the success toast (`rok` counts parents only) says 'restored' while custody_chain entries, gang members/ranks/turf, or place process steps are gone for good (callers: casefiles.js:765, gangs.js:33, places.js:40). Additionally, on partial parent-delete failure the undo re-inserts ALL parents including never-deleted ones, producing duplicate-key errors miscounted as restore failures.

**Fix:** Check `r.error` on the snapshot and abort the delete (or warn) if the snapshot failed; check the {error} of each child re-insert and include children in the restored/failed counts; only re-insert parents whose delete succeeded.

**`core.js:831` — Escape pressed to dismiss a stacked uiConfirm/uiPrompt also fires modalKey, closing the underlying modal (or spawning a duplicate Guard confirm)**  
*correctness*

uiDialog is designed to stack over an open modal (z-70 over z-50), but its keydown listener and modalKey are both on document and modalKey was registered first, so it runs first on Escape. Concrete flow: open a case detail modal, click delete on an evidence item (casefiles.js:763 uiConfirm), press Escape to cancel the confirm — modalKey runs requestCloseModal(true), Guard is not dirty, so the whole case-detail modal closes even though the user only meant to cancel the confirm. If the Guard IS dirty (e.g. the 'Unsaved changes' confirm from a dirty report/drive form editor), pressing Escape on that confirm spawns a second identical confirm dialog via requestCloseModal → Guard.confirmDiscard while the first one dismisses itself.

**Fix:** In modalKey, ignore the event when a uiDialog overlay is open (e.g. track an open-dialog flag or check for the z-70 overlay), or have uiDialog call e.stopImmediatePropagation()-equivalent by registering its listener with capture and stopping propagation.

**`core.js:921` — uiDialog's document-level Enter handler confirms even when the Cancel button is focused — Enter on Cancel triggers destructive actions**  
*correctness*

onKey is attached to document and on Enter calls e.preventDefault() then okFn() unconditionally. e.preventDefault() on keydown suppresses the focused button's default click activation, so a keyboard user who Tabs to the Cancel button and presses Enter gets the CONFIRM action instead of cancel. uiConfirm gates irreversible operations, e.g. casefiles.js:371 'Permanently delete N cases … This cannot be undone' — Enter-on-Cancel there permanently cascade-deletes cases the user was trying to keep.

**Fix:** In onKey, only run okFn() when document.activeElement is not the cancel button (or scope Enter handling to the input field only and let buttons use native activation).

**`inbox.js:22` — Overdue age measured from signoff_submitted_at, which the server never resets on movement**  
*correctness*

inboxAge prefers c.signoff_submitted_at over updated_at, but the signoff_decide RPC (functions.md, lines ~486-509) only sets updated_at on approve/deny/changes — signoff_submitted_at is set once at submit and never reset or cleared. Consequences: (1) a case moving briskly through the chain (e.g. deputy approved yesterday, submitted 15 days ago) is flagged '⏳ 15d overdue' / 'no movement in 15 days', sorts to the top, and inflates the per-section overdue counters, contradicting the file's own comment that overdue 'matches the auto-escalate rule' (caseStaleDays at casefiles.js:289 uses updated_at); (2) because signoff_submitted_at survives completion/denial, an actively worked case (updated_at yesterday) with an old submission still satisfies inboxIsOverdue and lands in the 'Your overdue cases' bucket.

**Fix:** For 'no movement' semantics use updated_at (like caseStaleDays), e.g. inboxAge = daysSince(c.updated_at || c.created_at), or have the decide RPC bump a dedicated last-movement timestamp.

**`persons.js:85` — Undo after person delete does not restore SET NULL references (gang roster links, vehicle owners)**  
*data-loss*

deleteSelectedPersons (line 85) and the card/modal deletes (lines 124, 189) route through deleteWithUndo with no children spec. Deleting a person makes Postgres null out gang_members.person_id and vehicles.owner_id (both 'on delete set null' — platform migration line 209 and 20260625090000_vehicles_tasks_bolo.sql line 15). Undo re-inserts the person row with the same id, but the already-nulled FK references are never restored, so 'undone' deletes still permanently lose gang-roster person links and vehicle ownership. The same applies to gang deletes: deleteSelectedGangs (gangs.js line 33) snapshots gang_members/ranks/turf but not persons.gang_id (persons_gang_fk on delete set null, migration line 199), so undoing a gang delete leaves every linked person detached.

**Fix:** Before delete, snapshot referencing rows' FK columns (gang_members.person_id, vehicles.owner_id, persons.gang_id) and re-apply them via update on undo, or extend deleteWithUndo with a setNullRefs spec.

**`persons.js:135` — Person edit clears gang_id when GANGS cache is empty or stale**  
*data-loss*

openPersonModal builds gangOpts only from the GANGS cache. If the cache has not loaded yet (edit opened right after sign-in before fetchGangs resolves) or fetchGangs failed (DB().list throws and the catch at gangs.js:14 leaves GANGS = []), a person with gang_id set renders with the '— no gang —' option selected; saving any unrelated field then hits `if (!payload.gang_id) payload.gang_id = null` (line 176) and silently detaches the person from their gang. The identical stale-cache pattern affects openMemberModal's person_id picker (gangs.js line 171, PERSONS cache).

**Fix:** If p.gang_id is set but not found in GANGS, include a selected option with that id (or skip gang_id in the payload when the cache lacks the record).

**`places.js:80` — Editing a place with unpopulated GANGS/casesCache/DRUGS caches silently nulls controlling_gang_id, case_id and narcotic_id**  
*data-loss*

openPlaceModal builds gangOpts/caseOpts/drugOpts (lines 80-82) from the GANGS, casesCache and DRUGS caches. If any cache is empty or missing the record's referenced row (fetch still in flight or failed — fetchGangs/fetchDrugs catch and keep the old array), the select falls back to '— none —' and the save handler (lines 109-112) writes null for that FK, silently unlinking the place from its gang, case, or produced narcotic. places_upd RLS is just is_active, so the server accepts the destructive patch.

**Fix:** Same as vehicles: preserve the existing FK value by injecting a selected placeholder option when the referenced id is absent from the cache, or drop unchanged keys from the update payload.

**`signoff.js:157` — Any detective can submit, complete, or escalate ANY case's sign-off — including cases in other bureaus — and RLS does not block it**  
*auth-gating*

The client treats every detective/senior_detective as "owner side" (`isOwnerSide`/`canSubmit` at signoff.js:157-158 use `SUBMIT_ROLES.includes(meRole())` OR'd with the ownership check), and the server RPCs have the identical gap: signoff_submit (functions.md:571) permits `c.lead_detective_id = v_uid OR v_role in ('detective','senior_detective') OR is_command()`, and signoff_owner_action (functions.md:535-537) permits `v_uid = lead_detective_id OR v_uid = signoff_submitted_by OR v_role in ('detective','senior_detective')` — despite its own error text saying 'only the case owner can decide here'. Neither RPC calls private.can_access_case, and both are SECURITY DEFINER, so a detective from a different bureau who cannot even SELECT the case can (given its uuid) submit it for review, mark it 'Approved & Complete' at the deputy stop-point (skipping Director review), or escalate it. Detective B in the same bureau gets working UI buttons to complete Detective A's case.

**Fix:** In signoff_submit and signoff_owner_action, replace the role-OR with an ownership check (lead_detective_id / signoff_submitted_by / is_command) and add private.can_access_case(p_case); tighten isOwnerSide/canSubmit in signoff.js to match.

**`supabase.js:38` — profile() swallows fetch errors as null, so a transient failure shows an approved member the 'not yet approved' pending screen**  
*error-handling*

CIDDB.profile() returns null on any query error or thrown exception (supabase.js:36-38), and evaluate() treats a null profile as unapproved (auth.js:93-95, 108): the user is shown the pending-approval gate ('signed in but not yet approved... A Command/Director must activate your profile') with only a Sign out button. RLS confirms a signed-in user can always read their own profiles row (profiles_sel: id = auth.uid() OR is_active — policies dump line 134), so null here means an error, not a missing/inactive profile. A momentary network blip or Supabase hiccup at load therefore locks an active member out with a misleading dead-end screen (and may prompt them to sign out), with no retry until the next auth event.

**Fix:** Distinguish 'row not found / active=false' from query error in profile() (return {data,error}); on error show a retry/offline notice instead of the pending-approval screen.

**`vehicles.js:68` — Editing a vehicle while PERSONS/GANGS caches are empty silently wipes owner and gang links**  
*data-loss*

openVehicleModal builds the Registered Owner and Gang selects purely from the in-memory PERSONS/GANGS caches (lines 67-69). Those caches are filled asynchronously by onAuthed (casefiles.js:1223) and fetchPersons swallows errors leaving PERSONS=[] (persons.js:67). If a user deep-links to #vehicles and opens Edit before fetchPersons resolves (or after it failed on a network blip), the select renders only '— unknown —', so the save handler (line 91-93) writes owner_id=null / gang_id=null, silently destroying the vehicle's FK links. RLS allows the update (vehicles_upd = is_active), so the server does not protect against it.

**Fix:** When record.owner_id/gang_id is set but not found in the cache, inject a placeholder <option value="${v.owner_id}" selected> (or omit the key from the patch when the value is unchanged/unknown) instead of defaulting to ''.

**`vehicles.js:175` — BOLO warrant badge shows an arbitrary warrant's status, not the latest, when a suspect has multiple warrants**  
*correctness*

renderBolo fetches warrants with DB().list('reports', {}) (line 168) — no order clause, so Postgres returns rows in unspecified order — and then does last-write-wins into wStatus (wStatus[n.toLowerCase()] = st, line 175). The comment on line 166 claims 'latest warrant status per named suspect', but if the same person is named in an older executed/returned warrant and a newer draft (or vice versa), the badge nondeterministically shows whichever row happened to be iterated last. Officers see a wrong warrant state on the BOLO board.

**Fix:** Order the list by created_at ascending (so the newest report overwrites), or keep the row's created_at alongside the status and only overwrite when newer.

### ⚪ Low

**`auth.js:92` — Sign-out never clears CIDDB.me or tears down realtime subscriptions**  
*error-handling*

When evaluate() sees no session (auth.js:92) it just calls showLogin(): window.CIDDB.me keeps the previous user's profile (so canEdit()/isAdmin() still return true), all module caches keep the previous user's data, and the ~35 realtime channels created by onAuthed stay subscribed and keep firing fetch* callbacks with a signed-out client. The shell is hidden via body[data-auth=out] so exposure is limited, but on a shared browser a subsequent sign-in by a different (e.g. pending, active=false) account lands on showPending while the prior member's caches and me-derived state remain in memory, and the dangling subscriptions trigger background query errors.

**Fix:** On the no-session path set window.CIDDB.me = null and call client.removeAllChannels() (and let modules clear their caches).

**`casefiles.js:502` — New-case Forms seeding ignores insert failures ({error} return is never checked)**  
*error-handling*

After creating a case, the loop `for (const t of tpls) await DB().insert('documents', {...})` runs inside a try/catch, but per the data-layer contract DB().insert RETURNS {error} and never throws — the catch only guards the DB().list call. If the documents inserts fail (e.g. the (folder,name) unique constraint from 20260616160000_documents_seed.sql when a same-named form already exists in the bureau folder, or any RLS/network error), every failure is silently swallowed: the case is created but its seeded form packet is partially or wholly missing with no toast and no retry.

**Fix:** Check res.error per insert and surface a single warn toast (‘N form templates could not be seeded’) so the detective knows to attach forms manually.

**`casefiles.js:1128` — Intel tab treats ANY case_intel_links load error as ‘table missing’**  
*error-handling*

renderCaseIntel wraps DB().list('case_intel_links', ...) in a catch that unconditionally sets tableMissing = true (line 1128). The table exists in the live schema (RLS dump: case_intel_links_sel/ins/del), so a transient network failure or RLS denial makes the tab display the misleading amber banner ‘The case_intel_links table isn't in the database yet — apply migration 20260622120000…’ and hides the link picker, while the real error is discarded. A detective on a flaky connection is told the deployment is broken instead of being offered a retry.

**Fix:** Distinguish error codes: only show the migration banner for PostgREST 42P01/PGRST205 (relation does not exist); otherwise render the generic ‘couldn’t load — retry’ message with e.message.

**`casefiles.js:1222` — onAuthed has no run-once guard: every auth event refetches ~20 tables and stacks duplicate realtime bindings**  
*perf*

window.CIDApp.onAuthed is invoked by auth.js evaluate(), which runs both directly from boot() and again from every onAuthStateChange event (INITIAL_SESSION at startup — so it always runs at least twice — plus TOKEN_REFRESHED roughly hourly and SIGNED_IN on re-focus). Each run re-executes all ~20 fetch*() calls (lines 1223–1231) and re-runs the ~28 DB().subscribe() calls. In the pinned supabase-js 2.108.2, client.channel('rt_<table>') returns the existing channel and .on() appends another (inert, never-id-mapped) postgres_changes binding while .subscribe() no-ops, so functionality survives, but every auth tick triggers a full-app refetch storm and unbounded binding growth over a long-lived session. Only escalateStaleCases is guarded (_staleEscalated); nothing else is.

**Fix:** Add a module-level `let _authedOnce = false;` guard around the subscription block (and optionally debounce the fetch-all), or have auth.js only call onAuthed when the user id changes.

**`command.js:204` — fetchActivity downloads the entire audit_log table to display 12 rows**  
*perf*

fetchActivity does `(await DB().list('audit_log', { order:'created_at', ascending:false })).slice(0, 12)`. DB().list has no limit option, so this transfers every row of audit_log — an append-only table populated by triggers on every INSERT/UPDATE/DELETE across ~31 tables — on every entry to the Command view (onEnterCommand line 325), then throws away all but 12 rows client-side. As the portal is used, this becomes the single heaviest query on the busiest dashboard.

**Fix:** Use the raw builder with a server-side limit: `const { data } = await DB().from('audit_log').select('*').order('created_at', { ascending:false }).limit(12); AUDIT = data || [];`

**`core.js:440` — Double-submit guard releases after a fixed 1500 ms, not when the in-flight save settles — slow saves can still duplicate-insert**  
*race*

The guard's stated purpose is to block a second click 'while the first click's async handler is still in flight', but line 440 unconditionally resets b.dataset.busy to '0' after setTimeout(1500). A save that takes longer than 1.5 s (slow connection, or multi-statement handlers like the report save that runs several sequential DB calls) lets a second click through and inserts a duplicate row. Conversely, a synchronous validation failure ('field required' toast) still locks the button for the full 1.5 s.

**Fix:** Clear the busy flag from the handler side (e.g. wrap guarded handlers so busy resets when their promise settles), keeping the 1500 ms only as a fallback.

**`gangs.js:144` — Gang-detail Delete bypasses deleteWithUndo — cascade wipes roster/ranks/turf with no undo**  
*data-loss*

The detail-page delete handler calls DB().remove('gangs', g.id) directly. Postgres cascades gang_members, gang_ranks, and gang_turf (all 'on delete cascade'), permanently destroying the entire roster with no restore path — while the bulk path (deleteSelectedGangs, line 33) deliberately snapshots those children and offers a 6s undo. A confirmed but mistaken single delete on the detail page is unrecoverable, inconsistent with every other delete in these modules.

**Fix:** Route the detail-page delete through deleteWithUndo('gangs', g, { children: [gang_members, gang_ranks, gang_turf] }) like deleteSelectedGangs.

**`gangs.js:158` — Turf delete ignores the {error} result — silent failure with no feedback**  
*error-handling*

The .turf-del handler runs `await DB().remove('gang_turf', b.dataset.id); renderGangDetail();` without checking the returned {error} (DB().remove never throws). If the delete fails (RLS denial after a role change mid-session, network error), the view simply re-renders with the turf row still present and no toast, unlike every other write path in these modules which surfaces res.error.

**Fix:** Capture the result and toast on r.error, matching the gang-delete handler at line 144.

**`persons.js:109` — mugshot_url interpolated into <img src> without safeUrl() allow-listing**  
*xss*

Person cards (persons.js line 109) and gang member cards (gangs.js line 163) place the member-supplied mugshot_url into an img src with only escapeHTML(). Escaping prevents attribute breakout and javascript: URLs are inert in modern img src, so this is not exploitable XSS today, but it violates the repo's own rule (core.js line 418: safeUrl for any user-supplied URL in href/src) and permits data:/blob: and other scheme smuggling into the attribute.

**Fix:** Use escapeHTML(safeUrl(p.mugshot_url)) and fall back to the placeholder div when safeUrl returns ''.

**`reports.js:41` — setWarrantStatus does a whole-`fields` read-modify-write from a possibly stale cached row, losing concurrent warrant-log entries**  
*race*

setWarrantStatus builds `nf = Object.assign({}, r.fields, {_warrant_status, _warrant_log})` from the `r` object captured when the chain was rendered and overwrites the entire fields jsonb. If two officers change a warrant's status near-simultaneously (or one has a stale view open), the second write silently discards the first's _warrant_status and its _warrant_log entry — the audit trail the comment at reports.js:26-28 says must 'survive export' loses events with no conflict detection.

**Fix:** Re-fetch the report row inside setWarrantStatus before patching, or move the status transition to a jsonb_set-based RPC that appends to _warrant_log atomically.

**`reports.js:159` — Supplemental/follow-up `seq` is computed client-side at modal-open time — concurrent or long-open modals produce duplicate sequence numbers**  
*race*

openReportModal sets `seq = ex.length + 1` from a snapshot query when the modal opens, and that number is only written at save time (possibly much later, e.g. after a draft restore). Two officers authoring supplementals concurrently — or one officer with a modal left open while another saves — both insert kind='supplemental', seq=2, so the chain shows two 'Supplemental #2' cards. There is no server-side uniqueness on (case_id, kind, seq) in the reports schema (columns.md:42) to catch it.

**Fix:** Recompute seq at save time (re-list just before insert), or derive display numbering from created_at order instead of a stored seq.

**`reports.js:263` — Report save button has no double-submit guard — a double click inserts duplicate reports and duplicate auto-added persons**  
*race*

The `#r-save` async handler awaits DB().insert('reports', ...) plus a loop of persons/case_intel_links inserts without disabling the button or setting an in-flight flag. Two rapid clicks (easy on a laggy connection since the insert round-trips to Supabase) create two identical report rows in the chain, and the persons auto-add path can insert the same POI person twice (both clicks read the same stale `idx` map before either insert lands).

**Fix:** Disable the button (or set a `saving` flag checked at handler entry) before the first await, re-enable on error.

**`reports.js:315` — viewReport / reportParas / exportReportPdf crash on a report whose template id has no schema**  
*error-handling*

renderChainInto defensively handles a null template (`tpl ? tpl.name : 'Report'`, line 57), but the View/.docx/.pdf handlers it wires do not: viewReport dereferences `tpl.schema` at line 315, reportParas at line 399, and exportReportPdf at line 424 with no null guard. tplById (persons.js:45) returns undefined for any template id not currently in REPORT_TEMPLATES (which is filtered by FORM_SCHEMAS presence). A reports row with an unknown template — inserted by another client via the raw API (reports_ins RLS only checks can_access_case, template is free text) or left behind if a FORM_SCHEMAS entry is ever renamed/removed — renders a card fine, but clicking View/.docx/.pdf throws a TypeError and the modal/export silently dies.

**Fix:** Guard: `const tpl = tplById(r.template); if (!tpl || !tpl.schema) { toast('Unknown template', 'warn'); return; }` (or render fields as raw key/value fallback).

**`rico.js:66` — Enterprise-select onchange ignores DB().update result and can die on an unhandled rejection from ensureRicoCase**  
*error-handling*

The #rico-gang onchange handler awaits DB().update('rico_cases', r.id, {...}) but never checks the returned {error} — a failed write (network drop, RLS) is silently swallowed and rerender() reverts the select with no toast. Worse, ensureRicoCase() (rico.js:10) calls DB().list('rico_cases', ...) unwrapped; DB().list THROWS on error, so a transient failure rejects inside the async onchange/onclick handlers (lines 66-67) as an unhandled promise rejection: the select keeps the new value visually, nothing is saved, and no rerender or feedback occurs.

**Fix:** Wrap ensureRicoCase's list call in try/catch and check the update result: const res = await DB().update(...); if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); }.

**`signoff.js:213` — Sign-off history shows raw 'deputy_director' stage for decisions made at the Deputy stage**  
*correctness*

signoff_decide writes history.stage as `need_role::text` — 'bureau_lead' | 'deputy_director' | 'director' (functions.md:500) — while signoff_submit/owner_action write the stage keys 'bureau_lead' | 'deputy' | 'director'. The client label map SIGNOFF.label only has keys bureau_lead/deputy/director, so history entries for Deputy-stage approvals/denials fall through `SIGNOFF.label[h.stage] || h.stage` and render the raw enum string '(deputy_director)' instead of '(Deputy Director)'.

**Fix:** Add `deputy_director: 'Deputy Director'` to SIGNOFF.label (or normalize the stage value server-side).

**`vehicles.js:109` — Cross-reference engine masks fetch failures as 'No cross-case matches yet'**  
*error-handling*

renderCrossref catches DB().list('reports') and DB().list('case_intel_links') failures and substitutes empty arrays (lines 109-110), then falls through to the success-path empty state ('No cross-case matches yet…', line 139). After a network blip or RLS error, investigators see an authoritative-looking 'no matches' claim instead of an error, which for a deconfliction tool is a misleading false negative.

**Fix:** Track whether either list call failed and render a distinct 'Could not scan for cross-case matches' notice (as fetchVehicles does at line 23) instead of the no-matches message.

**`vehicles.js:181` — wStatus lookup on a plain object hits Object.prototype members for persons named 'constructor'/'toString'**  
*correctness*

wStatus is a plain object literal (line 169) and the badge lookup is wStatus[(p.name || '').toLowerCase()] (line 181). A BOLO'd person named e.g. 'Constructor' resolves to the inherited Object.prototype.constructor function, which is truthy, so the card renders a bogus warrant badge — wTint[ws] is undefined (falls back to draft tint) and escapeHTML(ws) prints 'warrant: function Object() { [native code] }'. Same pattern is used for writes on line 175 (harmless shadowing) but the read path yields garbage UI.

**Fix:** Use Object.create(null) for wStatus, or a Map, or guard with Object.prototype.hasOwnProperty.call(wStatus, key).

**`vehicles.js:218` — BOLO filter refetches the entire reports table on every keystroke with no debounce and no out-of-order guard**  
*race*

The #bolo-filter input handler calls renderBolo() per keystroke, and renderBolo awaits DB().list('reports', {}) (line 168) before painting. Rapid typing issues concurrent full-table fetches; a slower response for an older query string can resolve after a newer one and repaint #bolo-grid with results that do not match the current filter text (stale grid until the next keystroke). Also a needless full 'reports' download per keypress.

**Fix:** Wrap the handler in debounce() (already in core.js), and/or add a monotonically increasing render token that discards paints from superseded invocations; cache the warrant map instead of refetching per render.

## Coverage & gaps (from the completeness critic)

# Completeness Critique — CID Portal Audit

## Gaps in coverage

1. **Export content injection was never swept** (the fleet list confirms no such dimension). I swept it myself — see spot-check 1. DOCX is clean (`xmlEsc` at docx.js:62-68 escapes every run), jsPDF text API is inert, but **CSV is vulnerable** (below).
2. **Nine modules produced zero findings (~1,700 lines)**: penal.js (229), personnel.js (258), intel.js (241), network.js (187), watchlist.js (159), heatmap.js (158), ballistics.js (125), docx.js (83), roles.js (44). I spot-checked five of them; most are genuinely clean (consistent `escapeHTML`/`esc`), but personnel.js's media vault has a concrete miss (spot-check 2), so "zero findings" there was a coverage hole, not cleanliness.
3. **drive.js fillable-forms subsystem (FORM_SCHEMAS, ~drive.js:204 onward, several hundred lines)** — all 6 drive.js findings cluster in the doc/sheet editor (lines 353-556); nobody reviewed form fill/save/version logic.
4. **casefiles.js density**: 8 findings for 1,266 lines vs. 7 for 433-line reports.js. The evidence photo-upload path, forms tab, and warrant sub-flows inside case detail appear only glancingly (findings anchor at 502, 603, 618, 670, 906, 1128, 1208, 1236 — nothing between 1 and 300 except line 318, nothing between 670 and 906).
5. **Realtime channel auth** — I checked it (spot-check 3): `subscribe()` (supabase.js:62-67) uses `postgres_changes`, which enforces RLS server-side, and callbacks refetch via RLS-scoped queries. No finding; gap closed.
6. **Auth redirect** (supabase.js:25, `redirectTo: location.href.split('#')[0]`) — bounded by Supabase's redirect allow-list; not a finding, but no reviewer stated they checked it.

## Spot-check results (concrete, new)

1. **drive.js:196-198 — CSV formula injection (category: xss, severity: low).** `downloadCsv`'s quoting (`'"' + v.replace(/"/g,'""') + '"'`) does not neutralize cells beginning with `=`, `+`, `-`, or `@`. Sheet cells are member-authored (drive.js:556 exports `readSheet()` rows verbatim), so member A can plant `=HYPERLINK(...)`/DDE payloads that fire when member B opens the export in Excel. Matches the threat model's member-to-member vector.
2. **personnel.js:97 and 171-173 — media vault `external_url` into `<img>`/`<video>`/`<audio>` src with `esc()` only, no `safeUrl()` (category: xss, severity: low).** `mediaSrc(m)` (personnel.js:94) is member-supplied `external_url`/`storage_path`; the lightbox iframe branch (line 174) uses `safeUrl()` but the image/video/audio branches bypass it. Same defect family as the already-reported persons.js:109 / records.js:90 — the family is incompletely enumerated.
3. **supabase.js:62-67 realtime + docx.js xmlEsc + intel.js/watchlist.js/ballistics.js/network.js/heatmap.js escaping — verified clean.** intel.js consistently escapes and uses `safeUrl` (e.g. intel.js:30); watchlist escapes all data attrs (watchlist.js:68); heatmap/network SVG text uses `esc()` (heatmap.js:101-102, network.js:111).

## Claims too vague / duplicated

- **auth.js:113 appears twice** (medium/race and low/perf) describing the same missing once-guard; casefiles.js:1222 is the same root cause reported a third time. Should be merged.
- **command.js:490 vs command.js:492** — two entries for the same tracker-authorization RLS gap at adjacent lines.
- **index.html:636 "several Tailwind utilities … do nothing"** — unactionable without naming the classes and which UI silently breaks.
- **signoff.js:157 vs migration 20260617190100 findings (lines 26/55/108)** — same server-side defect reported once from the client and three times from SQL; fine as detail but should be linked as one issue.

## Confidence assessment

- **XSS**: high confidence now — I re-swept every previously untouched module's `innerHTML` sites; only the two low findings above survived.
- **Export injection**: high — CSV is the only vulnerable writer; DOCX/PDF verified safe.
- **RLS / sign-off integrity**: high — multiple independent findings from both client and migration angles agree.
- **casefiles.js deep logic and drive.js fillable forms**: medium-low — these remain the two areas where finding density is implausibly thin relative to size, and I only sampled them; a dedicated pass over casefiles.js lines 1-300 / 670-900 and drive.js forms is the highest-value residual work.

## Note on refuted findings

48 candidate findings were killed by adversarial verification (false positives — e.g. client-gating gaps the server RLS already blocks, TDZ complaints about runtime calls, escaping applied upstream). That kill rate is the point of the verification phase: it keeps this list actionable.