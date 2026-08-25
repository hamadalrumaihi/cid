# Changelog — CID Portal

This project follows [Semantic Versioning](https://semver.org) as of
**v1.0.0** (adopted 2026-07-09). Given the app has a single deployed
instance, versions mark *release milestones*: MAJOR for breaking platform
changes, MINOR for feature releases, PATCH for fixes. Each release lists
the merged PRs that compose it.

## [Unreleased] — Records & Requests domain + 10-phase roadmap

### Portal-wide UX pass — 2026-08-25

One coordinated usability pass across the whole portal. No permissions or
RLS semantics changed anywhere in it — every new surface renders what the
viewer's own policies already allow.

**Search & create**
- Universal search (Cmd/Ctrl-K) now also reaches BOLOs, case tasks,
  intelligence submissions and division members (never emails), alongside
  cases, reports, evidence, operations, legal requests, persons, gangs,
  places, vehicles, accounts, narcotics, ballistics, documents and charges.
  Results are grouped with per-kind tags; record hits open as Investigative
  Tools record tabs; task hits deep-link the case Tasks tab. `search_all`
  gained `bolo`/`task` arms + a `case_tasks` trgm index (`20260826010000`).
- Palette commands are permission-gated: Go-to entries for Owner, Command
  and SIB surfaces are no longer listed for everyone; a New-record command
  set runs through the new universal **+ Create** header button
  (`shell/CreateHost.tsx` — lazy-loaded exported registry modals for
  case/person/vehicle/gang/place/account/indicator/operation/SIB
  investigation; bottom sheet on mobile). Palette is full-screen on phones.

**Pins, recents & saved views**
- Pins (`src/lib/pins.ts` over the new `user_pins` table) follow the member
  across devices; recents (`src/lib/recents.ts`) are a device-local
  ids-only trail. Both feed the Command dashboard "Jump back in" strip with
  Clear-history; titles are RLS-resolved at render, so records the viewer
  lost access to disappear silently.
- Saved views (`src/lib/savedViews.ts` over `user_prefs`) on the Cases,
  Persons, Legal and BOLO lists — rename, per-list default, cross-device;
  legacy device-local case views are migrated automatically.

**Case workspace**
- Case sections keep their state when switching (keep-alive, per-tab scroll
  restore); section pills carry live counts and attention markers; the
  header is a compact two-line jacket; a phone-width section switcher
  replaces the overflowing strip; the "since your last visit" recap is no
  longer consumed by tab switches (seen-stamp written on case exit).
- Bulk actions on the case list: set status (open/active/cold), assign lead
  (command-only), archive/restore — preview confirms, read-only-row skips,
  chunked progress. Closing stays per-case through sign-off; no bulk
  delete, ever.

**Relationship-first records**
- Existing relationship links are editable (`shared/LinkEditPopover.tsx`):
  confidence, current/historical/disputed status, role and note — instead
  of delete-and-recreate. The relationship audit now snapshots old/new link
  content (`private.audit_detail()`), and `case_intel_links` gained its
  missing UPDATE policy (legal hold still vetoes).
- Bounded search pickers for linking; RecordPeek preview panels
  (`ui/RecordPeek` + `src/lib/entityPreview.ts`); new panels — vehicle
  linked people, gang accounts & narcotics, account surveillance history;
  non-blocking duplicate-match warnings when creating persons/gangs/
  vehicles; pin buttons on record profiles.

**Autosave**
- Drafts sync to the server (`src/lib/userDrafts.ts` over `user_drafts`:
  debounced upsert, per-user local mirror closing the shared-terminal leak,
  offline degradation) with a Saving/Saved/Offline chip (`ui/SaveState`) on
  reports, case notes, chat, person/gang creation and intel summaries;
  restore banners with explicit Discard; saved drafts surface in the Action
  Center. The legal wizard keeps its own stash flow.

**Action Center & notifications**
- New Action Center lanes — Unassigned intel, Expiring BOLOs, Drafts — with
  why-it's-here and next-action copy, type/bureau filters and specific
  empty states.
- Notifications group by case/record with accurate unread counts, one-click
  mark-all and per-category mutes for OPTIONAL streams only (assignments,
  mentions, sign-off decisions, legal and security can never be muted);
  identical unread duplicates are suppressed server-side within 1 hour.

**Status & access consistency**
- One status vocabulary through the central registry (`src/lib/status.ts` +
  `ui/StatusBadge`) with meaning / who-acts-next tooltips; the warrant
  return state is labeled **"Return filed"** to stop colliding with the
  legal-review "Returned for revision". Access badges (`ui/AccessBadge`)
  render the SIB visibility / legal classification / SOP classification
  vocabularies consistently.

**Database** (`20260826010000_ux_personalization.sql`, applied live and
mapped in `supabase/MIGRATION-HISTORY.md`)
- Three per-user tables — `user_pins`, `user_drafts`, `user_prefs` —
  owner-only RLS, no audit triggers, no realtime, size-capped jsonb.
- `private.audit_detail()` old/new snapshots on the relationship-link
  tables; `case_intel_links` UPDATE policy (role/note editable);
  `create_notification` 1-hour identical-unread dedupe; `search_all`
  bolo/task arms.

### Investigative Tools workspace

**Fourteen intelligence tabs, one nav item.** The Intelligence category's
tabs (Persons, BOLO Board, Gangs, Places, Vehicles, Accounts, Indicators,
Intelligence, Network, Narcotics, Ballistics, M.O. Detector, Media Vault,
Records) are consolidated behind a single **Investigative Tools** item
(`/tools`) in both the CID and SIB sidebars: a grouped tool directory
(Intelligence Records · Operational Tools · Analysis, with live RLS-scoped
counts) plus a multi-tab workspace — open several tools side by side as
tabs, switch instantly (open tabs stay mounted, so searches, filters and
scroll survive), drag to reorder, close one / others / all with a
dirty-tab guard, and an "Open tabs" dropdown on small screens. Persons and
Vehicles open individual records as their own tabs
(`RECORD_TAB_TOOLS`). Open tabs persist per signed-in user for the session
as **ids only** and restore with titles re-fetched through the RLS-scoped
client — a record the viewer can no longer see closes silently. **No
functionality removed, no permissions or RLS changed**: every tool renders
the same RLS-scoped view it always did, and the old routes (`/persons`,
`/persons?person=<id>`, …) stay valid — a redirect shim
(`ToolTabRedirect`) forwards them into the workspace with their query
params intact, so bookmarks, notifications and cross-links keep working.
Model in `src/lib/toolsModel.ts` (data only); workspace, lazy tool
registry and shim in `src/components/tools/`.

### Bureau restructure — Major Crimes / Street Crimes / SIB

**Three bureaus replace the geographic model.** The database migration is live
(`20260825120000_bureau_restructure.sql` +
`20260825121000_bureau_restructure_finalize.sql`, applied in stages via MCP —
see `supabase/MIGRATION-HISTORY.md`): the `bureau` enum values are renamed in
place — LSB (Los Santos) → `major_crimes` (**Major Crimes Bureau**, MCB:
serious, violent and complex investigations) and BCB (Blaine County) →
`street_crimes` (**Street Crimes Bureau**, SCB: gang, narcotics and firearms
work, surveillance, repeat offenders, proactive enforcement) — while ex-SAB
(State) members and cases are redistributed by case signal (SAB does not map
1:1). The SIU is renamed the **Special Investigations Bureau** (SIB) with its
entire compartmentalization model intact: `case_authority='siu'` internals,
the X-1 Special Agent in Charge command chain and the separate SIB→Attorney
General legal path are unchanged, and every internal `siu_*` identifier keeps
its name — only terminology changed. SIB-native cases now carry
`bureau='special_investigations'` (CHECK-enforced to `case_authority='siu'`).

**Case numbers are permanent.** New cases number `MCB-4######`,
`SCB-5######`, `SIB-8######` (continuing the old SIU-8 series) and
`JTF-3######`; existing `LSB-`/`BCB-`/`SAB-`/`SIU-` numbers are preserved
verbatim, and `role_events` divisions are frozen as text so member history
keeps its historical labels. Legal requests route to the Major Crimes /
Street Crimes prosecutor queues via `responsible_bureau`; membership requests
offer Major Crimes / Street Crimes only (SIB stays appointment-only, JTF a
temporary joint-case designation). The field-intel geographic jurisdiction
routing (city→LSB, blaine→BCB) is gone — every active CID member sees every
field submission. LSPD/BCSO/SAHP remain as external field *agencies*, not CID
bureaus. The live SOP document is renamed "Special Investigations Bureau SOP"
with SIU→SIB terminology throughout (substance preserved), and the docs
(`USER-GUIDE`, `AUTHORIZATION`, handbook, `supabase/README`) follow the new
model.

### User Guide rewrite + CID/SIU visual redesign

**The User Guide describes the portal that exists.** `docs/USER-GUIDE.md` is
rewritten as an operational manual (workspaces → first five minutes → navigation
→ running a CID case → running an SIU investigation → intelligence intake →
legal requests → records → reports & sign-off → troubleshooting). Gone with it:
the claim that legal review "terminates at Bureau Lead+ with no Judge, ADA, DA
or AG step" (the revived prosecutor + judicial pipeline has been live for
weeks), the retired-on-date development history, the assumption that every new
person applies for CID membership (intelligence-only submitters have their own
immediate path), and a case-tab walkthrough naming tabs that no longer exist.
The in-app guide (`GuideView`) now renders the REAL case tab rail from the same
module `CaseDetail` routes with (`caseTabs.ts`), shows both legal lanes (CID:
command review → prosecutor queue → prosecutorial review → judicial review;
SIU: X-1 → Attorney General → Judge), the access fork, SIU orientation with
the visibility states, and files My Desk under Command where it lives.
`WORKFLOWS.md` and `AUTHORIZATION.md` lose the RETIRED banners that the code
contradicted and gain the SIU legal lane, the intake workflow, the
`siu_members_work_cid` reversal and the registry-compartmentation authority.

**One disciplined design system.** Three surface levels, 4–8px corners for
routine records (large rounding reserved for modals), no glows on ordinary
elements (`shadow-glow` left Button/Toaster/Modal/dialog/ActionMenu for real
elevation shadows), the primary button is a solid accent instead of a gradient,
badges are squared record chips, nothing operational renders below 11px, and
the sub-tab underline finally follows the user's accent instead of hardcoded
blue. A ~40-icon professional stroke set (`shell/icons`) replaces emoji
wherever a glyph functioned as an interface control — the command palette,
cross-record chips, toasts, report-template buttons, calendar markers, action
menus and evidence type markers; decorative emoji in user content is untouched.

**Evidence reads like a record system.** The case Photos & Media tab shows
photographs as a gallery and video/audio/documents/links as compact records
with file-type icons, evidence number, category, uploader, time and linked
report — no more head-height empty tiles containing one emoji. Case tabs are
grouped into the three areas a detective thinks in (Investigation · Evidence &
Case Record · Coordination & Closure) with routes untouched, and the content
column caps at 1600px so 2560-px monitors stop stretching panels edge to edge.

**SIU looks restricted, not purple.** Violet is reserved for identity and
visibility-state markers (crest, classification chips, compartment states); the
purple washes over ordinary SIU panels are gone, and a compact status strip
under the header names the workspace and the standing you act under whenever
you are inside SIU. To CID, nothing about SIU rendering changed — a restricted
record is still an ordinary "not found".

**Legal UI mirrors stop lying** (display accuracy only — no authority moved):
an SIU request in command review is never captioned "CID Review"; X-1 sees SIU
requests as actionable in the Action Center, the case Legal tab and the
dossier; the judge-claim mirror accepts only what the server accepts; and
`useMyProsecutorBureaus` reads the live coverage tables, so a current-role
prosecutor's bureau-awareness lane works. One production gap is documented
rather than papered over: `review_legal_request_as_ag` remains EXECUTE-revoked,
so an SIU request approved by X-1 has no reachable Attorney General action yet.

### Portal edits — layout and permissions

**The legal-request form is one centred column.** The wizard root was full width
while only *some* children carried `max-w-3xl` and none were centred, so the
form sat hard against the left edge with the rest of the row empty. Header,
stepper, restore banners, form card and navigation now share one
`mx-auto w-full max-w-3xl` container. The container is centred; the content is
not — a centred label above a left-aligned input reads as a mistake, and centred
narrative text is hard to write in.

**Charges no longer wait for a Bureau Lead.** `proposed` and `under_review`
existed solely to hold a charge in a command queue and are gone from the CHECK
constraint, not merely made unreachable. A charge is live the moment an
authorised investigator adds it. The self-approval bar went *with* the approval
step: a charge is now live when its author adds it, so a rule saying "you may
not approve your own" would make every charge unaddable.

The **court lane is untouched, deliberately**, and that is the half worth
stating: `filed` still requires a prosecutor, ADA, DA or Attorney General, and
`convicted`/`dismissed` still require a judge. Removing internal command review
is not the same as letting a detective record a conviction. 30 live charges (29
`proposed`, 1 `under_review`) were migrated to `approved` with the row trigger
disabled for that one statement — it enforces the very transition being removed
— and re-enabled immediately.

**Legal-request review: mostly already there, two real gaps closed.** Worth
being straight about — `can_approve_legal()` already admitted Deputy Directors,
Directors and the Owner for *any* bureau, there is no claim or assignment gate
on CID review at all, and a `command_fallback` line was already logged naming
who stood in. Higher command could always act immediately. What was missing:

- **Rank was never recorded.** `cid_reviewed_role` now captures the reviewer's
  CID rank *at the time*, because reading `profiles.role` at render time answers
  a different question and goes wrong on the first promotion. Historical rows
  stay NULL rather than being backfilled from today's roles — that would be
  inventing a fact about the past.
- **The client was more permissive than the server.** `viewerOwnsAction` admitted
  *any* `bureau_lead` for `cid_supervisor_review`, while the database requires
  their division to match the responsible bureau (or a JTF case). A BCB lead saw
  an Approve button on an SAB request and got an exception on click — the exact
  inverse of the SIU mistake the code comment right below it warns about.

**Every active SIU member works CID.** The wall was not where it looked: the
shared registries all gate on `is_active()`, which SIU members always passed, so
they could already create and edit persons, gangs, vehicles, places, accounts,
indicators, narcotics and ballistics. The read-only feeling came from exactly
**two functions** — `can_access_case` and `can_access_case_row` — each carrying
`not is_siu_department()`. That one conjunct removed CID cases and everything
scoped to a case. Zero RLS policies referenced it directly, which is why a large
change is a small migration.

`private.siu_member_active()` replaces it, and is deliberately **not**
`siu_operates()`: that is true for `oversight` (the Attorney General), who
supervises SIU and is not a member of it. It inherits
`siu_membership_role()`'s active / not-removed / not-oversight-only checks, so a
suspended or removed member loses this immediately with no second check to keep
in sync. No CID role is required.

Two client helpers built on the old wall were corrected rather than patched
around. `siuCaseReadOnly` no longer marks a CID case read-only for an SIU member
— and, caught by an existing test, must *not* strip an Attorney General's CID
rights either. `mayCreateCidCase` is deleted: its own comment recorded that it
existed only to hide a control because of "a real server-side oddity, not a fix
for it". The oddity is fixed, so the guard is empty.

**Live proof**, run as the real accounts:

| Probe | Result |
|---|---|
| SIU member sees / edits a CID case in another bureau | 1 row / 1 row changed |
| SIU member adds a task, a report, a case post | accepted / accepted / accepted |
| Charge added by its own author lands as | `approved` |
| Same investigator files it / convicts it | refused (attorney only) / refused (court only) |
| Same investigator withdraws it | 1 row changed |
| CID detective reads SIU targets / ledger / notes / watchlist | 0 / 0 / 0 / 0 |
| SIU SAC promotes a member to Director | role unchanged (`detective` → `detective`) |
| SIU SAC grants themselves Owner | `is_owner` still false |

That role probe is worth keeping: the first version asserted the **affected-row
count** and read "1 row changed", which looked like SIU could promote people. An
UPDATE that matches a row and is silently reverted by a trigger still reports one
row affected. Reading the value back showed nothing had changed. Row counts prove
a match, not a mutation.

### Three buttons that did nothing

`Button` renders `type={type ?? 'button'}` — a deliberate default, since most
buttons in this app are not submits. The consequence is that a `<Button>` inside
`<form onSubmit={...}>` with no `type="submit"` and no `onClick` is completely
inert: not disabled, not erroring, just silently unclickable.

Three had shipped that way, found when somebody tried to press one:

- **Restrict Entire Record** / **Restrict Selected Intelligence Only** — the
  whole compartmentation confirmation.
- The reveal / restrict / resolve confirmation in the SIU workspace.
- **Ask the library**, which had been dead since the day it merged.

Every other gate passed all three. It typechecks, it lints, it renders, and the
visual suite screenshots an inert button as happily as a working one. So there
is now a gate that reads what the other gates cannot: `check:submit` fails the
build if a `<Button>` inside a form with `onSubmit` declares neither
`type="submit"` nor its own handler. It was verified against the real defect
before being wired in — a check that cannot fail is not a check.

### Restrict to SIU, on the record you are looking at

Two defects in how S2 shipped, both about reach rather than enforcement.

**The action was in the wrong place.** To hide a person you had to leave their
profile, open the SIU workspace, find Compartments and search the registry for
the record you were already reading. Every one of those steps is a chance to
pick the wrong person, and the cost of picking the wrong person here is that CID
silently loses access to somebody. **Restrict to SIU** now sits on the record
itself — person, vehicle and organisation profiles — with the subject already
chosen and unmistakable. The workspace entry point stays for when you are
working from a list.

**The Director could not reach the authority they had just been given.** S2
widened `siu_may_control_visibility()` to include them and proved live that they
could restrict and reveal. What that probe never asked is whether they could
ever *get* there: the only screen exposing it lived inside the SIU workspace,
gated on `siu_available` → `siu_operates()` → `siu_standing() is not null` —
which is NULL for a Director by deliberate design. The permission was real and
uninvokable.

The fix is deliberately not to widen `siu_available`. That would hand the head
of CID the entire SIU workspace — intake, investigations, targets, sources —
which is the precise arrangement migration `20260902120000` exists to prevent.
Instead `siu_department_context()` carries `may_control_visibility` as its own
narrow capability, so the action can appear on a record without opening a single
SIU screen. It never fails open: absent, the client reads false and shows
nothing.

### Two ways to restrict, and a compartment that reaches the whole graph

S1 hid four registry tables. That closes the front door and leaves the windows
open: `gang_members` still said *somebody is in this organisation* with the
hidden person's id attached, `person_relationships` still drew the edge,
`account_links` still tied them to a handle, `media` still listed their
photographs. Any one of those establishes that a person exists and who they
associate with — most of what hiding them was for.

The predicate now sits on **~71 policies across nineteen tables** — accounts and
indicators as registries in their own right, plus every link and child table
that names one: relationships, memberships, addresses, vehicles, accounts and
handles, organisation structure and territory, narcotics intelligence,
ballistics, site processing and media. **SELECT, UPDATE, DELETE and INSERT.**
Insert matters as much as the rest: without it a CID user could attach a row to
a hidden person and learn from the success that the person exists.

**Two restrictions, named for what they do.** *Restrict Entire Record* takes the
record and everything under it. *Restrict Selected Intelligence Only* leaves the
profile with CID and takes only the sections named. The second exists because
the common case is a person CID has known for months who becomes the subject of
an SIU file — hiding them removes CID's own work, leaving everything exposed
exposes the investigation, and neither is right. The server computes which is
recommended (`sections` whenever CID already has a stake) so the screen never
re-derives the rule and gets it subtly different.

**The second confirmation is a parameter, not a dialog.** Restricting a whole
record CID already builds on is permitted and costly. A dialog enforces nothing,
so the acknowledgement travels as `p_acknowledge_cid_impact`; without it the RPC
refuses *and* returns the impact, which is exactly what the confirmation screen
renders. `siu_restriction_impact()` is both the screen's data and the server's
guard, so the figure on the page and the figure in the guard are one figure.

**Who may do this, and the trap in asking.** All three SIU ranks, the Director
and the Owner. `siu_is_command()` is *not* that set — it is X-1 and the Owner
only — and the Director cannot be reached through `siu_standing()`, which
returns NULL for them by deliberate design: migration `20260902120000` removed
the director branch precisely so the head of CID could not command the unit
that investigates CID. So the Director is matched on `profiles.role` directly,
in one shared function used by every policy and RPC.

Including them has a cost, stated plainly: you cannot release what you cannot
see, so control implies read. The Director now sees compartmented **registry**
material. They do **not** gain SIU case material — `siu_targets`,
`siu_case_notes`, `siu_sources` and `siu_watchlist` keep their own predicates,
untouched. That containment is the difference between *the Director can audit
what SIU hid from CID* and *the Director can read the file on themselves*.

**A record can be born hidden.** "SIU-created records must never automatically
appear in CID" cannot be met by marking a record after inserting it — between
those two statements it is live and visible. `siu_visibility.entity_id`
deliberately carries no foreign key, so the ledger row is written **first**,
against a client-chosen uuid, and the insert lands already compartmented.
Creating a person with SIU standing now asks the question, defaulting to
SIU Only. Nothing is inferred: there is still no trigger that marks a record
because an SIU member created it.

**Live proof**, each assertion run as the real account:

| Probe | Result |
|---|---|
| Baseline: CID sees the person and the graph edge | 1 / 1 |
| Preview: CID has contributed / recommended mode | true / `sections` |
| Preview: graph edges that would be lost | 5 |
| Whole-record restrict with no acknowledgement | refused — *contains information created or currently used by CID* |
| Mode 2: profile stays visible | 1 row |
| Mode 2: restricted sections (relationships, membership) | 0 / 0 |
| Mode 2: sections left alone (vehicles, addresses) | 1 / 1 |
| Mode 1: direct select / autocomplete / person search | 0 / 0 / 0 |
| Mode 1: graph edge, membership, vehicle, address, account link | 0 across all five |
| Mode 1: `search_all` on a unique tag, before → after | 1 → 0, no row carrying the id |
| Mode 1: CID creates an edge to the hidden person | refused |
| A detective calls `siu_restrict` / reads the impact preview | refused / refused |
| Director sees the restricted record / may reveal | 1 row / accepted |
| Director reads SIU case targets | 0 rows |
| Reserve then insert: SIU sees it / CID ever saw it | 1 row / 0 rows |

Production was restored exactly afterwards: 95 flags, zero restrictions, zero
audit rows, every registry count unchanged.

**One residual, recorded rather than left to be found.** `persons.gang_id` and
`vehicles.gang_id` are columns, not rows. When an organisation is restricted its
row disappears but a visible person still carries the uuid, so what leaks is
*a gang exists with this id that you cannot see* — no name, no members, no
places. RLS cannot null a column conditionally; closing it properly needs a
masking view over both tables.

### SIU compartmentation — the registry stops being one shared list

`persons`, `vehicles`, `gangs` and `places` were each `using
(private.is_active())`: every active investigator saw every row. An SIU agent
who added a person mid-investigation published them to all of CID the moment
they hit save. That is now closed by a conjunct — `not
private.siu_hidden(type, id)` — on the **SELECT, UPDATE and DELETE** policies of
all four. Update and delete matter as much as select: a row hidden from a query
but still updatable leaks its own existence, because an UPDATE reporting one row
affected confirms exactly what the SELECT denied.

**Origin is recorded going forward, never inferred backwards.** The obvious
migration — "rows created by an SIU member are SIU material" — is wrong here and
dangerously so. Both active SIU members are *also* senior CID staff: one is a
BCB bureau lead, the other is the Director. Classifying by creator would have
hidden **49 of 54 gangs, all 10 vehicles, 20 persons and 16 places** from CID
overnight, records those two built in their CID capacity. Membership is a
property of a person; origin is a property of an act.

So the migration classifies **nothing** retroactively. The 95 registry records
created by an SIU member are flagged `unclassified` — a state that is queued for
a decision and deliberately **does not hide** — and the flag records the
*evidence* rather than a conclusion: whether SIU material references the record,
whether CID's does, or neither. Only 2 of the 95 look SIU in origin; 69 are
demonstrably shared. **Absence of a ledger row means CID-visible**, so the
failure mode of a bug here is "SIU material stays visible to SIU", not "CID
loses its registry".

**The shared-record rule is enforced, not suggested.** A person CID already
holds does not become SIU property because SIU opens a file on them.
`siu_mark_origin` refuses outright — in the SECURITY DEFINER function, not in a
disabled button — and says why: the record stays shared, and it is the SIU
intelligence *about* it that gets compartmented.

**Who may do this.** Any active SIU standing plus the Owner. Not `oversight`,
which watches SIU rather than feeding it to CID. And **not the Director**, who
heads CID: letting them authorise release of SIU material into their own
division would invert the arrangement, most sharply for an integrity
investigation into CID personnel. The existing model already withholds SIU
command from them and this follows it.

**The audit.** `siu_visibility_events` records from-state, to-state, sections,
audience, the reason, and the authority the actor held *at the time* — roles
change, and the record of who was allowed to do this must not change with them.
It has no insert, update or delete policy at all, so nothing in the application
can rewrite or erase a disclosure.

A live role probe caught a real defect before this shipped: a wide release later
pulled back to a single named officer was being logged as **`expanded`**. Breadth
has two independent axes — audience and sections — that do not reduce to one
number, so each is now compared, and a move that is neither wider nor narrower
(one case to another, one officer to another) is named `redirected` rather than
guessed at. An audit that overstates a disclosure is worse than no audit,
because it will be believed.

**Live proof**, every assertion run as the real account:

| Probe | Result |
|---|---|
| CID persons before / after one record is compartmented | 264 / 263 |
| CID selects the hidden record by its exact id | 0 rows |
| CID updates it by id | 0 rows affected |
| CID deletes it by id | 0 rows affected |
| CID reads the ledger / the audit | 0 rows / 0 rows |
| CID calls `siu_mark_origin` | refused — *only SIU may compartment a record* |
| Director calls `siu_reveal_to_cid` | refused — *only SIU may release a compartmented record* |
| SAC compartments a record CID already holds | refused — *CID already holds this record, so it stays shared* |
| After reveal, CID sees it | 1 row |
| After narrowing to one officer: other detective / that officer | 0 rows / 1 row |
| SAC rewrites the audit | refused — permission denied |
| Eight-act audit trail | marked → revealed → reduced → redirected → expanded → reduced → expanded → restricted |

A compartment also no longer outlives its subject: `entity_id` carries no
foreign key (it points at one of four registries), so deleting a person used to
strand its ledger row — dead weight, and a row that would hide a *different*
record if that uuid were ever reused. The audit is deliberately left standing:
that SIU compartmented something stays true after the record is gone.

New in the SIU workspace: a **Compartments** section with the review queue
ordered so the genuinely ambiguous records come first, per-record history, and
reveal / restrict / take-in actions that each demand a written reason and state,
in a sentence, exactly who will be able to see the record afterwards — including
that restricting "removes access, not knowledge".

### Ask the library — retrieval, not generation

The portal has **no AI infrastructure**: no server-side model, no embeddings, no
vector store. The one thing calling itself an assistant is an Owner-only
page-agent that ships inert and, when configured, sends whatever is on screen to
an external LLM — which is precisely what must not happen to document content.

So this answers by **retrieval**. Ask a question in ordinary language and it
returns the actual sections of the actual documents, quoted from the database,
each cited with its document, section heading, version and effective date, and
linked straight to the paragraph. It cannot invent a legal requirement because
it never writes a sentence, and no document text leaves the database because
there is nowhere for it to go. The honest limit, stated on the panel: it finds
**where something is written**, not what it means.

**Confirmed and possible are kept visibly apart.** Two passes over the same
RLS-bounded search: sections containing *everything* asked about, and sections
mentioning *some* of it — labelled "Possibly relevant… this is not an answer".
A tool that presented both with equal confidence would be worse than no tool,
because people would stop checking.

When neither pass returns anything, the answer is **"No confirmed answer
found"**, naming the words it searched — and saying explicitly that this is *not
the same as "no such rule exists"*, it means the library does not record one.

**The access proof.** The SIU-classified SOP and its 19 sections, probed live
across every role available in this database:

| Role | Document | Sections | Search |
|---|---|---|---|
| Owner | 1 | 19 | 2 |
| Director | 0 | 0 | 0 |
| Bureau lead | 0 | 0 | 0 |
| SIU Special Agent in Charge | 1 | 19 | 2 |
| Detective (LSB and BCB) | 0 | 0 | 0 |
| Field-intelligence submitter | 0 | 0 | 0 |

Rank does not open it: a Director and a Bureau Lead see nothing. Every path
agrees because they are the same path — the table, the search RPC and the
assistant all resolve through the owning document's own RLS, so there is no
route that reaches further than the reader could by hand.

### The Penal Code becomes browsable

359 statutes in one flat searchable list: fine if you already knew the code you
wanted, close to useless for *what covers this*. Offenses are now **grouped by
the title of the code** they sit under — which is how the statute book is
actually organised — filterable, and comparable **side by side**, with only the
rows where two offenses genuinely differ picked out.

**All of it came from data the portal was already fetching and discarding.**
`penal_current_charges()` has always returned the title of the code, the
judge-set penalty flags, the PD exemption, the substance schedule and the
statutory notes; the client catalog dropped five of them on the way in. No new
tables, no new columns, nothing authored.

**"A judge decides" is not zero.** Eight offenses in the published code carry a
null penalty beside a `judge_set` flag — the database keeps them that way
precisely so a total can never quietly count a judge-set penalty as nothing. The
old row rendered an empty cell, which reads as *no fine*. The card now says
**Set by the judge**, and distinguishes that from *Not stated* and from *No
custodial term*.

The same care applies to arrest: `arrest_required` is nullable because a version
that says nothing is not a version that permits a citation. The card says **"The
code does not say"** rather than implying either.

**And a filter is only offered when the code in force can satisfy it.** Checking
the real data first turned up that the 2026 code records an arrest requirement
for **none of its 195 published offenses** — so an *Arrest required* checkbox
could only ever return an empty list. Availability is derived from the loaded
catalog rather than hardcoded, so a future version that does record arrests
lights the filter up on its own. This is the same defect, and the same fix, as
the RICO predicate picker offered against a code that designates no predicates.

**What is deliberately absent.** The brief asks each charge card to show
required legal elements, the evidence that commonly supports them, applicable
enhancements, and lesser or mutually exclusive offenses. None of that exists as
data anywhere in the portal — those would have to be authored by somebody with
the authority to say what the elements of an offense are. Generating them would
mean inventing legal requirements and setting them beside real statutory text
with nothing on screen to tell the two apart. The card says what the code says,
and the gap is stated on the page rather than filled in.

### Documents stop being isolated

`document_relations` has held **zero rows** since document governance shipped,
and the reason turned out to be embarrassing rather than complicated: the table,
its RLS and the reader's "Related" panel all existed, but **nothing in the portal
could ever create a relation**. The feature shipped read-only. Every promise
resting on it — related documents, "used in this workflow", conflict detection
between documents — was resting on an empty table.

**A document can now say what it relates to.** Whoever may edit a document can
link it to another document (*supersedes*, *see also*, *checklist for*) or to a
**place in the portal** where it applies. The second kind is the one that
matters: the evidence screen does not maintain a list of relevant policies, and
never needs updating when one is written. Documents declare their own relevance;
screens ask who declared it.

Routes are a fixed list rather than free text, because a typo in a route is a
relation that silently never appears anywhere.

**Contextual help follows from that**, on the Intelligence workspace and the
legal-request wizard — placed before the stepper there, because the standard you
have to meet is something you read *before* drafting, not after being refused.
It **renders nothing** when no document has claimed the route, which is the
honest state today: an empty "Related policies" heading on every screen would be
worse than silence.

**And links that have gone stale are now reported.** A document still citing
guidance that has since been archived or superseded is the quiet failure — the
workflow reads fine and points at something nobody maintains. Oversight now
flags it, as a warning for a human, never an automatic edit to either document.
A target the viewer cannot see is treated as unknown rather than stale: guessing
would leak the fact that the document exists.

Nothing here widens access. Writes are governed by the existing
`doc_rel_ins`/`doc_rel_del`, which admit only an editor of the *owning*
document; reads follow that document's own visibility. Probed live: an editor
linked a route and the lookup found it; a detective who cannot edit that
document was **refused** the insert, matched **zero rows** on delete, and could
still read the relation — which is exactly the intended shape.

### Search that lands on the paragraph

Ask the library "what evidence is required for a search warrant" and it returned
*Criminal Investigation Division (CID) Standard Operating Procedure* — 39,479
characters, somewhere inside which the answer sits. The reader already had a
table of contents, per-section anchors and copy-link-to-section; search could
not reach any of it, because `search_documents()` ranks whole **documents**.

Search now answers with a **section**: which heading matched, a highlighted
excerpt from that section, the document's version and effective date, and a link
that drops the reader on the paragraph rather than the title. The same query now
returns *"Title 5C | Evidence Handling & Chain of Custody"*.

**Why the index is not built in SQL.** The obvious move is to parse markdown
headings server-side. It does not survive contact with the data: **six of the
fifteen documents contain no `#` headings at all**, including the
15,891-character CID SOP and the Case Building Playbook. Their structure comes
from the renderer's heuristics — a short ALL-CAPS or trailing-colon line is a
heading, the lead line above a pipe table is a heading — and anchors carry a
de-duplication suffix from a counter running across every heading in document
order. Reimplementing that in plpgsql would put a subtle renderer in a second
language, and the day the two disagreed every copied section link would rot
silently. So there is no second parser: `renderDocumentMarkdown()` already
returns the exact headings it emitted, and a unit test pins the submitted
anchors to the rendered ones so drift fails CI instead of breaking links.

**Which raises the obvious question — if a reader submits the index, a reader can
lie**, and the lie would surface in *other people's* search results. So the
client never sends document text. It sends anchors and heading titles; the
server finds each heading in its own stored body and slices the section out of
that. Probed live: a genuine heading indexed 39,477 characters of real text, a
forged one indexed an **empty** section. Direct writes to the index are refused
outright — there is no insert, update or delete policy — and indexing a document
you cannot open is refused by the same test the SELECT policy applies.

Section visibility is the document's own, reached through an RLS-subject
subquery, so the two cannot drift apart: a section of a document you cannot open
does not exist for you, in the table or through the search.

The index repairs itself — whoever opens a document whose body changed since it
was last indexed rebuilds it for everybody, including documents rewritten by the
Drive sync, which nobody ever renders. Command also gets an explicit **Rebuild
search index** sweep for documents nobody has opened yet. It is not privileged:
it indexes exactly the documents that viewer could open by hand.

**Also fixed:** the snapshot's `documents_classification_check` was missing
`'siu'`, which the live constraint has allowed for some time and which one
published document already uses. `check:schema` compares columns only, so it
never noticed — the same blind spot could have hidden a policy change.

### Accounts could not be permanently deleted, and Intel Tips is gone

**The bug.** Freezing the reporting officer on an intelligence record was right —
a report is the account of who reported what, and reattributing it after the fact
is exactly the edit that must never happen. But the freeze was **absolute**, and
one legitimate write does change it: permanent account deletion repoints every
no-action reference to `profiles` at the tombstone, and
`field_submissions.officer_id` and `.created_by` are two of the ~159 such
references.

So the Owner's erasure path was being refused by its own guard — *"the reporting
officer on a record cannot be changed"* — and **any account that had ever filed
or authored intelligence could not be deleted at all**. The most destructive
operation in the portal was quietly broken by a guard written for a different
threat.

The trigger now recognises the erasure by its **destination**: a profile
reference on the row may move *to the tombstone*, which nothing else in the
portal ever does, and nowhere else. Reattributing a report to a real person is
still refused. The **snapshot stays frozen even during an erasure** —
`snap_officer_name`, `snap_callsign`, `snap_agency`, `snap_rank` and `snap_unit`
are text, are not references, are not repointed, and survive untouched. Keeping a
report readable after the account behind it is destroyed is the entire reason
those columns exist. Verified by walking the real reference map: **159 repoints,
zero failures**, with reattribution and snapshot rewrites still refused.

**Permanent deletion is one action now.** It was two: *Arm permanent deletion*
minted a single-use token, then a five-minute countdown ran while the Owner
retyped `DELETE <name>` into a confirmation box. The button now does the whole
thing. The server's two-phase contract is untouched underneath — arming is what
writes the ledger entry and re-checks eligibility at the moment of the write — so
what went away is the *ceremony*, not the record. The preview already says what
will be destroyed, and the reason field still feeds the audit log and the ledger.

**Intel Tips is dropped.** Held dormant for a release after the merge, as the
ticket system was: three tables, **zero rows between them**, nothing outside their
own children referencing them, and nothing writing to them since. Gone now, with
`tip_triage()` and the guard trigger that existed only to serve them, and with
the RLS pins that tested them — their successors on `field_submissions` are
stronger, and the source wall in particular has no SELECT test left to write
because `field_submission_sources` admits no role at all.

### Finding a record, and noticing when the same name keeps coming up

**Search reaches the whole record, not the summary field.** Everything a
reviewer might search by is spread across seven tables — the people, vehicles,
organisations, places and items named in a report each live in their own child
table, and somebody looking for *Rodriguez* is almost never looking for a report
whose **summary** says Rodriguez. One server-side function now covers the record
(including the frozen reporting identity, so "who filed this?" is a search), all
six claim tables, and the thread with the officer.

It cannot see further than the queue can: every hit is passed back through the
same readability guard the rest of the domain uses, which already knows about
jurisdiction, SIU sensitivity and soft deletes. A search that reached further
would be a way to enumerate records you are not allowed to open.

**Archived records are included, deliberately.** Archiving means "not being
worked", not "gone" — the whole promise of archive-over-delete is that the record
stays findable, and a search that quietly skipped them would break that promise
exactly when somebody is looking for the report they archived last month.
Searching is a *mode*, not another queue filter: the results span every queue,
because a reviewer who is searching has stopped asking "what is in my queue" and
started asking "where is that report". Each result says **why** it matched —
*matched a person*, *matched a vehicle* — so a record whose summary looks
unrelated does not read as a broken search. Deleted records stay out; they only
ever appear in the Owner's Deleted list.

**"Seen before" is now said out loud.** Three unremarkable reports naming the
same person are not three unremarkable reports, and nobody notices that reading
them a week apart. A record now shows what it names that also appears elsewhere,
with the other record numbers — *"Marisol Rodriguez — also named in 2 other
records — FI-2026-0003, FI-2026-0009"* — rather than a bare count somebody then
has to go hunting for.

Two strengths of signal, kept apart because they mean different things:

- **named** — the same text was written down twice. Cheap, noisy, and often
  right. Matched on kind as well as text, so a plate that happens to read like an
  alias does not become a lead.
- **matched to the same registry record** — a reviewer already linked both
  reports to the same person, vehicle, gang or place. Slower to accumulate and
  much stronger, because a human already decided they were the same.

Both sides are RLS-filtered, so the count is of records *you* can open — the
signal never hints at a report in a jurisdiction you cannot see.

### What follows from a record that matters

D2 gave a record the status **Being acted on**. It did not say what acting on it
looks like. Three things follow from a report worth acting on, and all three
already existed — on other screens, which a reviewer had to leave the record to
reach, retyping from memory what they had just finished reading. That is how a
case ends up titled *follow up* with an empty summary.

All three are now one action from the record, prefilled from it.

**Opening a case records permanent provenance.** The case number continues the
bureau's own established series — the same generator the New case form uses,
because a second numbering scheme for cases that happen to start from
intelligence would be a second numbering scheme. The link it leaves behind is
marked `originated` and **nobody can remove it**: not the person who made it,
not command, not the Owner. It is a fact about how the case came to exist, and
it does not stop being true because it later becomes inconvenient. The case's
Overview now carries a **Where this came from** panel, so in a year — when the
detective who opened it has moved on and somebody asks why this investigation
exists — the answer is on the case rather than in somebody's memory.

**Linking to an existing case keeps history.** A link somebody added afterwards
can be taken back, because somebody will link the wrong case. Taking it back
**stamps the row rather than deleting it**, so the record reads "linked on the
4th, unlinked on the 9th, wrong Rodriguez" instead of losing both events. A pair
can be linked, unlinked and linked again; the live one is unique, the history
keeps all of it.

**Surveillance observations cite the report that put them on the board.** An
observation belongs to a case, so the record has to be linked to that case first
— not a technicality, but what keeps every route from intelligence to a case
visible in the same link history instead of a third one nobody thinks to check.
Confidence defaults to the record's own reliability grade, since it is the same
judgement about the same information, and **`confirmed` is not on offer**: a
report *of* something is not a confirmation of it. Observations logged before
anybody realised which report they answered can be adopted the other way round.

Both link tables refuse a case the caller cannot open, from either direction —
linking to a case you cannot see would tell you it exists, and would put a
record you can read onto a screen you should not be reading. The link history is
**investigators only**, which is not the same thing: an external officer can read
their own report, so without that rule they would learn that CID opened a case
off the back of it. What happens to a report after it is filed is not the
submitter's to see, the same rule the SIU flags and the reviewer notes follow.

### Confidential sources, and the protection arriving with the option

D1 **refused** `confidential` as a source type rather than ship the option
without the protection, on the grounds that offering it first is how a source's
name ends up in a summary field half the bureau can read. This is the protection.

The identity lives in a table with **row-level security on, no policy at all, and
every privilege revoked** — PostgREST returns nothing to anybody, at any rank,
through any query. It is reachable only through an RPC that admits the handler
and the Owner and writes an audit row naming who looked. **Rank does not open
it**: command can see that a source exists and what it is called, because that is
on the record, and that is as far as rank gets you. A table command can read
directly is a table whose reads leave no trace.

What the record carries is the **codename**, which is what a reviewer actually
needs — *"CS-14 has been right four times"* is how you weigh what CS-14 says, and
it requires knowing nothing about who CS-14 is.

The ordering is enforced, not merely encouraged: the before-update trigger
refuses to let a record call itself confidential unless a protected source row
already exists for it — on a draft as much as on a sent record, since a draft is
freely editable by its author and that is exactly where the claim would be made.
The option and the protection cannot come apart again.

**One thing D2 left open, closed here.** `field_submission_readable()` — the
guard every RPC in this domain uses — had never learned about the soft delete, so
a caller holding the id of a deleted record could still archive it, grade it, and
would now have been able to link it to a case. It is brought into line with the
SELECT policy that already said exactly this.

### One lifecycle, and the difference between archiving and deleting

The statuses an intelligence record could hold were still describing the system
that got removed last week. Three of them — `intel_added`, `linked_existing`,
`linked_case` — were terminal states that all meant *somebody pressed "Add to
intelligence" and something was created elsewhere*. That button is gone; the
record already **is** the intelligence. `partially_reviewed` had the same
problem from the other end: claim verdicts already say precisely which claims
are decided, so a whole-record status repeating it in coarser form could only
ever drift out of agreement with them.

The lifecycle is now what a reviewer actually does:

| | |
|---|---|
| **Draft** | being written, visible only to its author |
| **New** | sent, nobody has picked it up |
| **Being reviewed** | somebody is working through it |
| **Waiting on the officer** | a question has been asked |
| **Reviewed** | looked at, understood, nothing further needed right now |
| **Being acted on** | worth acting on — a case, surveillance, an SIU referral |
| **Archived** | out of the active queues, still searchable, restorable |

`rejected` folds into archived. It meant "this was not worth anything", which
is one of the archive reasons — and keeping both meant two ways to say the same
thing, one of which sounded like an accusation about the officer who sent it.
**Reviewed is not the end of the road**: something read a week ago starts
mattering the moment a second report names the same person, so it reopens.

**Archiving needs a reason.** Not because a form should be tedious, but because
"why is nobody working this?" is a question somebody asks three months later and
*Unable to corroborate* and *Duplicate of an earlier report* are very different
answers. Everything is kept — evidence, claims, verdicts, provenance,
assignment history, SIU handling — and **Restore** puts the record back into
review with the archive reason retained as history rather than erased.

**Deleting is a different thing, and is treated as one.** It is the
administrative correction for a record that should not exist at all: a test
entry, a double submission, a misfire. So:

- It is **soft**. The row stays, invisible to every ordinary reader, with who
  deleted it, when, and why.
- It is **refused outright when anything downstream depends on the record** —
  claim links, verdicts, evidence, messages, assignment history, SIU handling, a
  linked case, a designated target. The refusal names what is in the way and
  points at archiving, which is the answer in nearly every case. *A case is
  never cascade-deleted because the intelligence behind it was.*
- It is **command and above**. An investigator can archive anything they can
  see; deciding a record should never have existed is a different call.
- The external officer who submitted it **can never delete it**, at any point.
  That is the point: a report is not withdrawable once CID has it.
- **Undeleting is the Owner's**, not command's — the person who deleted
  something should not be the only check on whether it comes back. There is a
  *Deleted* queue only they can see.

None of this is a second copy of the account-deletion system. Removing a person
from the portal and removing one intelligence record are separate concerns with
separate authority, and they stay that way.

### Intelligence is one thing

The portal had grown two systems for the same job. **Intel Tips** came first — a
detective writes down what they were told, grades it, triages it. **Field
Intelligence** came later for patrol and turned out to be the stronger model:
structured claims, per-claim verification, evidence, assignment history,
jurisdiction routing, SIU referral. Then *Add to intelligence* bolted them
together by **copying** a reviewed submission into a tip, so the same
information existed twice under two numbers and a detective had to know which
screen to read.

**The migration this was braced for had nothing to move.** `intelligence_tips`
holds zero rows; so do its links and its confidential-source table, and nothing
outside those two children references it. So this is not a data migration with a
compatibility layer — it is one system absorbing what the other knew how to say.

`field_submissions` is now the single Intelligence record and gains **source**
(patrol, detective, surveillance, internal intelligence, external agency,
other), **urgency** and **reliability** — the last two carried over from tips
with their vocabularies unchanged, because a second grading scale for the same
judgement means learning two.

**Investigators author intelligence directly.** *New intelligence* opens the
same structured form a patrol officer fills in, because they produce the same
kind of record. That is what one entity means in practice, and it is why the
separate "submit a tip" page is gone. The database decides the two things the
client should not: who is recorded as the author, and — for anything arriving
through the external portal — that its source is `patrol`, whatever the client
sends.

**Grading is the reviewer's, not the author's.** An officer reporting what they
saw is not the person to say how reliable it is, and somebody grading their own
account grades it high. Reliability also grades the **source**, not any claim:
a confirmed source can still say something that turns out wrong, which is
exactly why claim verdicts exist separately. The detail screen says so out loud.

**Nav is one tab.** *Intel Tips* and *Field Intel* are now **Intelligence**.
`field_submission_publish()` and *Add to intelligence* are gone with them — the
report already was intelligence. Reviewers' claim matches are untouched: those
are matches to real registry records, which was always the part worth keeping.

The tips tables stay in place for a release, empty and unreferenced — the same
treatment the ticket system got. Nothing writes to them.

One thing is deliberately **refused rather than shipped**: `confidential` as a
source type. It needs protected storage for the source identity, and offering
the option before the protection is how a source's name ends up in a summary
field half the bureau can read. The insert path refuses it until that lands.


### A roster, not a queue — and submitters out of the approval line

Field Intelligence submitters were still turning up in the CID approval queue,
with a green **Approve** button next to them. The cause was one line: the
applicant pool was "inactive, not removed, no membership request", and a field
submitter is **inactive by design** — the standing is deliberately not
`profiles.active`, because 22 intelligence tables are gated on that flag alone.
So the description fit them perfectly, and command was being asked to approve
people who had applied for nothing. One click would have made an external
officer a CID detective.

`pendingMembership()` now takes the set of accounts holding field standing and
excludes anybody who is a submitter **and** has no open CID request. A submitter
who later applies to CID is an applicant like anybody else and stays in the
queue. The same exclusion reaches the nav badge, the Command Overview tile, the
Action Center, the personnel table (no Approve button — they show as *Field
Intelligence*) and the inbox count, through one shared predicate rather than six
copies of the rule.

**Access is still immediate, and now it is also recorded.** Field Intelligence →
**Submitter access** lists everybody who can send CID intelligence: the identity
they gave, whether they self-registered or were appointed, when the access was
created, when they first signed in, how many reports they have sent and when the
last one arrived. Command additionally sees the sign-in email and last-seen time
— the same rule member emails have always followed. "Keep their login
information" means the account identity and the access history; there are no
credentials here, and there never were any to show.

The **Access requests** tab is gone with its wording: nothing files a request
any more, so a tab named after one was describing work that does not exist. A
**Legacy requests** tab appears only while genuinely undecided pre-self-service
rows remain, and rows belonging to somebody who has since created their own
access are marked superseded rather than left for somebody to rubber-stamp. The
rows themselves stay — that is history.

### Permanent deletion where the removal decision is made

The Owner-only deletion protocol was complete and correct and lived at
`/owner?s=deletion` — a different part of the app from the place anybody
actually removes a member. It is now rendered in the **Manage Officer** modal's
danger zone and on the access roster, for the Owner and nobody else.

It is the **same component** in all three places, not a second implementation:
one preview, one armed five-minute single-use token, one typed
`DELETE <display name>` confirmation, one ledger. A deletion path that grew its
own safeguards next to a member list is exactly how two paths end up with two
different sets of them.

One rename came with it. The soft removal was labelled *"Permanently remove from
CID"*, which was survivable while it was the most destructive button in the
modal and misleading the moment a genuinely permanent one appeared beside it.
It now reads **Remove from portal**, which is what it does.


### Permanent deletion stops being hand-maintained (and starts working again)

Phase B classified every foreign key pointing at `profiles` by hand — a ~90-entry
reference map and a matching ~40-statement repoint block, both correct on the
day. Since then the portal gained Field Intelligence, the whole SIU domain,
surveillance, narcotics, the penal code, documents, operations and
records/requests: **176 references neither list had heard of**.

That was not cosmetic. `permanent_delete_execute()` repointed what it knew and
then deleted the profile, so the first unrepointed NO-ACTION reference aborted
the run with a raw foreign-key error. Permanently deleting anybody who had
touched SIU, surveillance or Field Intelligence was simply broken.

The map is now **generated from `pg_constraint`**, so it cannot fall behind the
schema again. Only the judgement calls stay hand-written — which references are
immutable records that must block a deletion (court paper, signatures, custody,
report authorship, evidence collection, standing identity) and which are live
work somebody must hand over first. The SIU domain adds the second kind: a
covert operation's agent or handler, a source's handler, a watchlist entry or a
field report somebody is holding. Those are filtered on whether the work is
still live, so an operation that ended years ago is a record rather than a
reassignment somebody owes.

Everything else classifies itself from the FK's own delete rule: RESTRICT
blocks, CASCADE and SET NULL are counted into the ledger, NO ACTION is repointed
to the tombstone — and NO ACTION under a single-column UNIQUE has its row
deleted instead, which is the rule Phase B applied by hand to one table.

**The protocol is unchanged.** Owner-only, a fresh sign-in for both steps, a
five-minute single-use token, the typed `DELETE <display name>` confirmation,
the owner-only ledger, and soft removal remaining the default. Verified live: a
Director, a Bureau Lead and a detective are each refused at both `arm` and
`execute`.

**Provenance survives the account.** A submission already snapshotted the
agency, callsign, rank and unit of the officer who filed it; it now snapshots
their **name** too, so a report reads "John Smith · BCSO 412" rather than
degrading to "Deleted Member" once the account is gone. Probing the deletion
end-to-end turned up that the submission guard refused the tombstone repoint
outright — the guard now allows exactly that one move, with every snapshot
column still frozen. Verified: the account and its auth row delete cleanly, the
report survives pointing at the tombstone, and the identity on it is unchanged.

### Field Intelligence is an access class, not a bureau

`profiles.division` defaulted to **JTF** and `profiles.role` to **detective**.
Nothing was granted by that — `active = false` gates every investigative table —
but a BCSO deputy who only wanted to send CID a photo appeared in the roster as
a JTF Detective, because a column default said so. Both columns are now nullable
with no default: an account nobody has assigned anything to has no bureau and no
rank, which is the fact. JTF goes back to being what it always was, a joint-case
designation somebody chooses.

Accounts still carrying the untouched defaults — never activated, never removed,
never the subject of a recorded role decision — were cleared. Every account with
a decision behind it keeps what it says, including removed members, whose last
bureau and rank are history.

### Asking to send CID information is not asking for a job

The access request queue is gone from onboarding. `field_access_self_serve()`
creates the standing on the spot: choose Submit Intelligence, enter agency,
callsign, rank and unit, and the Field Intelligence portal opens.

That is safe because of what the standing **is**, not because somebody checked
it. A field officer is not `profiles.active`, so all 22 `is_active()`-gated
intelligence tables stay shut; they cannot read another officer's submission,
the review queue, claim verdicts, entity matching or anything SIU. Approval was
never the boundary — the access class is, and it is unchanged. Probed live: a
new BCSO submitter reads 0 persons, 0 vehicles, 0 gangs, 0 cases, 0 places and 0
intelligence tips, and can file their own report.

The one refusal that genuinely matters is honoured: a **login-denied** account
cannot self-serve its way back in, and neither can a removed one or an account
that already holds CID access.

**The reporting identity is not self-editable.** `field_officers` has no client
UPDATE path at all, so a BCSO Deputy cannot become SAHP Command later and
rewrite what their old reports say about who filed them — the snapshot each
submission takes at submit time stays true.

`field_access_requests` is kept, not dropped: rows filed while the queue existed
are a record, a pending one can still be answered through the same
`assign_field_officer()`, and command can still appoint somebody
administratively. It just no longer stands between a patrol officer and the
ability to tell CID something.

### SIU reads the network, and nothing gets promoted on its own

Claim verdicts answer whether what an officer reported happened. The SIU
question is what it says about a **structure** — who leads, who supplies, who
moves it, who enforces, where the money and the assets are.
`field_siu_enterprise` records that reading against the report, in the SOP's own
nine layers, with free-text roles because "shot caller", "stash operator" and
"launders through the tow yard" are all legitimate and a fixed vocabulary pushes
an agent into the nearest wrong word.

It does **not** replace the relationship tables. `gang_members`,
`person_relationships` and the rest stay where structural fact lives. A node
here is an assessment attached to one report, optionally pointing at the claim
it came from and optionally at a registry record — so following it backwards
reaches the officer, their evidence and the verdict somebody recorded.

**A node is a candidate, never a target.** Only a node resolved to a registry
record can be designated; designating calls the same `siu_designate_target()`
the SIU workspace already uses, and the report must have been **accepted** by
SIU first. Patrol cannot start an SIU case, and neither can a referral nobody
answered. The designated target carries `field_submission_id`, mirroring the
provenance column on `intelligence_tips`, so a target can say which patrol
report it came out of.

**Linking to an investigation does not move the report.** `siu_case_id` records
that FI-2026-0042 fed investigation X; the report keeps its number, its
jurisdiction, its CID queue and its CID assignee. Unlinking needs a reason, and
removing a mapped node is soft and needs one too — how the picture was built is
part of the picture, and a deleted wrong reading leaves the next agent deriving
the same wrong conclusion.

Like the follow-up candidates, the whole assessment is `private.siu_is_agent()`
and nothing else.

### SIU without a second intake queue

SIU is a specialist detachment inside CID, so it works the same reports out of
the same table. A patrol officer is never asked whether what they saw is a
bureau matter or a criminal enterprise — they cannot know, and asking produces a
guess. The report lands in its jurisdiction's queue and an **investigator**
marks the SIU angle afterwards.

Two strengths of signal, deliberately different: **flagged** is a workflow
indicator ("this looks like organized crime") that changes nothing about
handling, and **referred** is a formal ask, with a reason and one of the SOP's
nine categories. SIU accepts or declines; **X-1 assigns accepted work to Special
Agents**, and a CID Bureau Lead cannot — once something is in SIU investigative
handling it follows the SIU chain, not the bureau chain. The CID Director has no
automatic SIU authority here either.

**Referral is not a disappearance.** Jurisdiction, reporting officer, CID
assignee and every claim verdict stay exactly as they were, and the report stays
in its CID queue with the SIU history readable beside it. SIU interest is a
layer on top.

**One exception: public corruption.** An allegation against a public official or
a serving officer cannot sit in a queue readable by the bureau it may concern,
so referring under that category marks the report sensitive server-side and
narrows it to SIU, the officer who wrote it, the investigator who referred it
and the investigator holding it — CID command included in what is excluded. The
person referring is told this **before** they refer, not after.

**Follow-up candidates are SIU-only.** Surveillance, undercover work, source
development, controlled operations and target development are methods, and a
method is only useful while its subject does not know it is in use. That table's
SELECT policy is `private.siu_is_agent()` with no second branch: not the
submitting officer, not the CID detective holding the report. Marking one starts
nothing on its own — it records that the report is worth one of these.

SIU agents get their own queues over the same data — SIU referred, SIU assigned,
Organized crime, Narcotics, Firearms, Corruption, Fugitives. Gang/MC enterprise
and organized crime share a queue, because an MC **is** an organized-crime
enterprise and splitting them hides half the picture.

### Four child tables that never reached the parent

Found while probing the sensitive path, and older than SIU.
`field_submission_messages`, `field_submission_reviews`, `field_claim_verdicts`
and `field_claim_links` were gated on `private.is_active()` and nothing else —
so **any** active investigator could read the officer's message thread, the
reviewer-private notes, the claim verdicts and the claim links of **every**
report, including reports from a jurisdiction they cannot see. Their sibling
claim tables reach the parent through an RLS-subject subquery and narrowed
correctly all along; these four were simply never given the same treatment.

They now use the same `exists()` against `field_submissions`, so they follow the
parent's rules without restating them. Probed after the fix: an uninvolved LSB
detective reads 0 messages and 0 reviewer notes on a restricted report and 0
messages on a Blaine report, while the BCB detective reads that Blaine thread
and the submitting officer keeps their own.

### A claim that actually holds

`field_submission_claim()` took the row lock and then wrote `assigned_to`
unconditionally. Two detectives could not corrupt the row — the lock saw to
that — but the **second one won**, silently taking the report off the first. The
lock made the write atomic; it did not make the claim mean anything. The check
now happens inside the same lock, so the second claim is refused with a sentence.

**Releasing needs a reason**, because whoever picks the report up next needs to
know whether it was "not my area" or "I know this suspect personally". The
status deliberately does not wind back: the report **has** been looked at.

**Bureau Leads assign and reassign.** Taking a report off its current holder
requires a reason; handing out an unheld one does not, because there is nobody
it was taken from. A target who cannot see the report's jurisdiction is refused
server-side — assigning work to somebody who cannot open it is worse than
leaving it unassigned, since the queue then reads as handled and the named
investigator never sees it.

**`field_assignments` never forgets.** Claimed, released, assigned and
reassigned each append a row; nothing edits one. `authenticated` holds no
INSERT, UPDATE or DELETE on it at all — the RPCs are the only writers — and its
SELECT policy requires `private.is_active()`, so the officer who sent the report
cannot learn which detective is working it.

**And one hole closed.** Every review RPC is SECURITY DEFINER, which bypasses
RLS; they checked `private.is_active()` and nothing else. An active detective
holding a submission id from another bureau's jurisdiction could therefore
claim, decide or question a report the SELECT policy would never have shown
them. `claim`, `release`, `assign`, `decide` and `ask` now all check
`private.field_jurisdiction_visible()` inside the function, which is where it
matters for a caller who already has the id.

### Queues instead of a single list

The review screen was one list with a "show only open" toggle. It is now the
queues a reviewer actually thinks in — All, Unclaimed, Mine, Assigned, Needs
info, Los Santos / City, Blaine County, Processed — plus Access requests, with
counts on the ones that mean somebody is waiting. These are views over one
table, not separate inboxes: "Mine" and "City" can hold the same report, which
is the point. Each card now says what the report contains ("2 people · 1 vehicle
· 3 evidence items") before anybody opens it, via one `field_submission_counts()`
call rather than six child-table reads per row — SECURITY INVOKER, so it counts
exactly what the caller could have counted themselves.

### A patrol officer can now ask for the door

Field Intelligence shipped with one way in: command had to appoint an officer
out of nowhere, which meant command had to already know the officer wanted in.
A SAHP trooper who signed in saw the CID membership application and nothing
else — so their choices were to apply for an investigator post they were not
asking for, or to leave.

**The sign-in screen asks which one it is.** "Join CID / SIU" is the existing
membership request, unchanged. "Submit Intelligence" is a short four-field
request that lands in a queue. A pending request can be **withdrawn**: one
pending request per person is enforced by a unique index, so an officer who
picked the wrong agency would otherwise be stuck waiting to be told no before
they could correct it. A declined request shows **the reason**, because "no"
with nothing after it is how somebody applies four more times.

**A request grants nothing.** `field_access_decide()` re-checks
`private.is_command()` and then approves by calling the same
`assign_field_officer()` the Command Center roster already used — one way to
become a field officer, one audit trail for it. The trigger overwrites
`user_id` with the caller, so nobody files on somebody else's behalf, and it
refuses an account that already has portal access rather than putting a
confusing row in front of a reviewer. Declining without a reason is refused by
the database, not just by the form.

**The queue lives where the work is.** Access requests are a tab in the Field
Intelligence workspace, not a Command Center errand — a queue command has to go
somewhere else to work is a queue that quietly stops being worked. Every active
investigator can read it (they are the ones who recognise a name); only command
sees the decide buttons, and the RPC refuses everybody else regardless.

### Reports are routed by where they happened, not by a guess

`field_submissions.route` — a CID / SIU / "unsure" picker — is **dropped**,
along with `field_submission_route()`. It asked the submitter the wrong
question: a patrol officer cannot know whether an observation belongs to a
bureau or to the Special Investigation Unit, so the honest answers were a guess
or "unsure". In its place, `jurisdiction`: Los Santos / City, or Blaine County.
Where they were standing, they know.

A check constraint requires it on submit (drafts may still be blank), so a
report cannot reach *no* queue while the officer believes it was sent to
somebody. `private.field_jurisdiction_visible()` narrows
`field_submissions_sel`: LSB sees city, BCB sees Blaine, SAB and JTF see both,
and SIU and command see everything. Because a subquery inside an RLS policy is
itself subject to that table's RLS, narrowing the parent narrowed claims,
evidence, messages and verdicts with it — verified live rather than assumed.
Reviewers see the owning bureau next to the jurisdiction, since "Los Santos /
City" alone does not tell a detective whether the report reached them because
it is theirs.


### Submissions become intelligence

Sixth and last phase. Until now a verified claim was verified and then sat
there. This connects it to the investigative database.

**Nothing is created automatically.** Not a person, not a vehicle, not a gang,
and above all **not a case**. Matching *suggests*; a reviewer links; publishing
records the link. A submission that could mint records on its own would mean a
patrol officer's guess becoming a database fact with nobody's name against it.
Nor does anything merge: if a submitted plate matches an existing vehicle the
reviewer is told so and can link the claim to it — the vehicle row is not
edited and the claim keeps the officer's words.

**Provenance is the point.** P2 promised integration would happen at review
time through `intelligence_tips` and `intelligence_tip_links`, carrying the
submission id. This honours it: publishing creates **one** tip whose
`field_submission_id` points home, plus one tip link per claim a reviewer
matched. Following any of them backwards reaches the officer, their agency,
their evidence, and the verdict somebody recorded. `intelligence_tips` gains one
nullable column; its policies, triage lifecycle and RPC are untouched.

The tip arrives **`new` / `unverified`** whatever a reviewer decided about
individual claims. A tip's own triage is a separate judgement, and an external
submission arriving pre-accepted is exactly what must not happen.

**Matching respects the reader.** `field_claim_matches()` is SECURITY INVOKER
over `persons`, `vehicles`, `gangs` and `places` — all `is_active()`-gated — and
refuses a field officer outright. An entity-matching endpoint is precisely the
shape of thing that leaks a database one lookup at a time.

**A normalizer bug, found by testing against the real gang roster.** The spec's
example is that *Drenger Blade MC*, *Drenger Blades MC* and *Drenger Blade
Motorcycle Club* are one organization. All three collapsed correctly — but
*Drenger Blade M.C.* did not, normalizing to `drengerblademc` and failing to
match. The word-boundary regex cannot see a dotted abbreviation as a word. Dots
are now stripped *before* the suffix step. Acronyms are unharmed: `HAMC` stays
`hamc` rather than becoming `ha`, and the real roster entries `Sinful Reapers
MC` and `Devils MC` normalize as expected.

Probed live against real records, rolled back:

| attempt | result |
| --- | --- |
| officer runs matching | `not authorized` — refused outright, not an empty result |
| officer links / publishes | refused |
| plate `"podyl873 "` (lowercased, trailing space) | matched the real `PODYL873` — **exact** |
| `"Sinful Reapers Motorcycle Club"` | matched the real `Sinful Reapers MC` — **exact** |
| link to a nonexistent target | refused |
| reviewer writes the link table directly | refused — the audited RPC is the only path |
| publish | tip `source=patrol status=new reliability=unverified`, provenance correct, both entity links written |
| publish twice | refused: *already in the intelligence database* |
| records created | **persons +0, vehicles +0, gangs +0** |
| officer reads links or tips afterwards | 0 and 0 |

One probe number needed checking rather than reporting: it showed `cases -18`.
That was **my own measurement artifact** — the baseline was counted as
`postgres` (all 22 cases) and the final count as a CID detective, who sees only
the 4 that `can_access_case` allows. Verified afterwards: **22 cases, unchanged.**
Nothing was deleted.

**Repetition is shown as a count and nothing more.** When several submissions
name the same plate or organization the reviewer is told *"also named in N other
submissions — worth a look, not corroboration."* Three officers can repeat one
rumour, and presenting frequency as corroboration is how that becomes a fact
nobody checked.

### Claim-level verification: deciding about the parts, not the whole

Fifth phase. A field report is several separate assertions, and confirming one
says nothing about the others:

```
John Doe                        VERIFIED
driving ABC123                  VERIFIED
John Doe → vehicle ABC123       VERIFIED
John Doe → Drenger Blade MC     UNVERIFIED
seen at Postal 2025             VERIFIED
```

Accepting or rejecting that as one indivisible thing loses four true claims to
protect against one unconfirmed one, or accepts the unconfirmed one to keep the
four. Neither is what a reviewer means.

**A verdict is a separate table, not a column on the claim.** The obvious
implementation is a `verdict` column on each of the five child tables, and it is
wrong here for a specific reason: those tables' UPDATE policy is
`field_submission_my_draft`, so a reviewer has **no UPDATE on them at all** —
deliberately, because P4 established that a reviewer must not be able to rewrite
the officer's account and then review it. Adding a verdict column means granting
reviewers UPDATE on the claim rows, and with it the ability to edit the claim
text. So the officer's account stays immutable and a verdict is a separate
assertion *about* it, in a table only reviewers can reach.

**Five nullable foreign keys, not a polymorphic key.** `claim_id uuid` plus a
`claim_kind` text would be shorter and would have no referential integrity at
all — a deleted claim would leave a verdict pointing at nothing and nothing
would notice. Here the cascade takes the verdict with the claim, and
`num_nonnulls(...) = 1` keeps exactly one target.

**`unverified` is not a soft rejection**, and the wording is tested to keep
saying so: *"Useful, but not confirmed. This is not the same as wrong."* It is
tinted neutral rather than as a failure. `disputed` is the different thing —
something CID holds contradicts it.

**Evidence attached still is not verified.** There is no path from "this claim
has a photo" to a verdict. A verdict is a person's judgement, recorded with
their name on it.

Probed live, rolled back:

| attempt | result |
| --- | --- |
| **officer reads verdicts** | **0 rows** — reviewer-only |
| officer records a verdict | `not authorized` |
| reviewer changes their mind | **1 row**, replaced not accumulated, old value in the audit |
| unknown verdict / unknown claim | refused |
| reviewer writes the table directly | INSERT refused, UPDATE **0 rows** — the audited RPC is the only path |
| reviewer edits the claim text | **0 rows** — still cannot rewrite the account |
| verdict on an unsent draft, holding the claim id | refused: *that report has not been sent yet* |

That last one is worth spelling out. The first attempt passed for the *wrong*
reason — RLS hid the draft claim, so the lookup returned NULL and the RPC said
"no such claim", never reaching the draft guard. Since `field_claim_decide` is
SECURITY DEFINER its internal lookups bypass RLS, so the guard genuinely matters
for anyone who already holds the id. Re-probed with the id captured out of band:
the reviewer sees **0 rows** through RLS *and* the RPC refuses on the guard.
Two layers, both real.

### Field Intelligence Review, and the ticket queue goes dormant

Fourth phase. Patrol could file structured, evidence-backed reports; now CID and
SIU can work them — and the thing this replaces is switched off.

**Reviewer-private notes finally have a home.** P2 and P3 both shipped
deliberately *without* internal notes, because P1 had already proved the
tempting implementation does not work: a column-level revoke cannot subtract
from a table-level SELECT grant, and revoking the table grant locks command out
too. A private field on a shared table is not achievable that way. So notes are
a separate table whose SELECT policy is `private.is_active()` and nothing else.
A field officer is not active — that is the whole design from P1 — so there is
no row of it they can reach, no column list to maintain, and nothing to get
wrong when a column is added later.

**Two kinds of writing, kept apart:**

| | who reads it |
| --- | --- |
| `field_submission_reviews` | reviewers only — **never** the officer |
| `field_submission_messages` | reviewer and officer both |

Different tables rather than one table with a *visible to officer* flag, because
that flag is the sort of thing somebody eventually forgets to set and internal
reasoning ends up in front of the person it is about.

**Reviewers act through RPCs, not UPDATE.** CID's direct UPDATE on
`field_submissions` is **removed entirely**. Claim, decide, reroute and ask are
each SECURITY DEFINER functions that write their own audit row with a reason. If
a direct update also worked, the audited path would be the polite option rather
than the only one — and a reroute between CID and SIU would go unrecorded
exactly when somebody wanted it to. Rerouting requires a reason because which
unit sees a report about police conduct is not a filing detail.

**Answering a question does not change the review state.** The obvious design —
an officer's reply bumps `needs_info` back to `reviewing` — was rejected. It
would need a trigger writing a status the officer is otherwise forbidden to
write, and more importantly it is not true: an officer answering does not mean a
reviewer has resumed. The reviewer moves it when they pick it up; the queue
flags that a reply is waiting.

Probed live, rolled back:

| attempt | result |
| --- | --- |
| **officer reads reviewer notes** | **0 rows** — CID sees 1, the officer sees none |
| officer writes a reviewer note | refused |
| CID direct `UPDATE` on a submission | **0 rows** — the RPC path is the only path |
| `reviewing → submitted` | refused: *a submission cannot go from reviewing to submitted* |
| reroute with a blank reason | refused |
| officer calls `field_submission_decide` | `not authorized` |
| officer messages unprompted | refused |
| officer replies while `needs_info` | allowed, and `from_reviewer` stored **false** despite the client sending `true` |

**The ticket queue is dormant, as a fact rather than a promise.** `public.tickets`
keeps its definition, its single row and its audit history — deleting them would
break permanent-deletion repointing and destroy history for nothing. What it
loses is the ability to grow: INSERT, UPDATE and DELETE are revoked from
`authenticated`, so no client can create a ticket whatever the interface offers.
Verified: CID reads the 1 existing ticket and is refused both insert and update.
`TicketQueue.tsx` and its constants are gone; the agency→bureau mapping they held
now lives where it is actually used, in `fieldOfficers.ts`.

### Evidence, and the project's first Supabase Storage bucket

Third phase of the Field Intelligence portal. Patrol can now back a report up
with screenshots, clips and documents.

**This introduces a second authorization system, and that is the significant
part.** Every access decision in this project until today was RLS on a table in
`public`. Storage is not that: a file is governed by policies on
`storage.objects`, a different table with its own policy set — and **a bucket
marked public bypasses them entirely**, serving anything in it to the open
internet with no session at all. That is why the project had no buckets before:
238 media rows, every one an external URL, and a migration recording plainly
that the app *"never calls supabase.storage.\*"*.

So `field-evidence` is **private**, and every read is a short-lived signed URL.
There is no public path to an evidence file.

**One ownership rule, not two.** The obvious mistake would be to invent a
separate model for files — "the uploader owns the object" — and end up with a
file whose access rules disagree with the report it belongs to. Instead the
object path carries the submission id:

```
field/<submission_id>/<uuid>.<ext>
```

and the storage policies resolve that id back through exactly the helpers the
submission tables already use. **A file is visible precisely when its report
is**, and writable precisely while that report is an unsent draft. There is
deliberately *no* update policy: overwriting an object in place would change
what a piece of evidence is while its row, title and audit trail still described
the old one. Replacing evidence means deleting and re-adding.

A path segment that is not a uuid would raise `22P02` from inside a policy — a
confusing way to be denied — so `private.uuid_or_null()` returns NULL instead,
and NULL fails the ownership test. A malformed path is simply refused.

**Medal links stay links.** A Medal clip is a page on medal.tv, not a file:
there is nothing to download and re-host, and an officer should never have to
export a clip and re-upload it. Evidence therefore has two shapes, `upload` and
`link`, and a link keeps its original URL untouched. `is_medal` is recognised
from the URL **by a trigger**, not accepted from the client — so a reviewer can
be shown a player without the client getting to claim what a URL is.

Probed live, rolled back:

| attempt | result |
| --- | --- |
| bucket visibility | `public = false` |
| officer uploads into own draft | 1 row |
| officer uploads into own **sent** report | refused |
| officer uploads to `field/not-a-uuid/…` | refused by policy, not a cast error |
| officer uploads outside `field/` | refused |
| client sends `is_medal: true`, `added_by: <a detective>` | stored **false**, and the caller — both discarded |
| `https://medal.tv/…` | `is_medal` **true**, set by the trigger |
| `javascript:alert(1)` as evidence | refused |
| row pointing at another submission's folder | refused by check constraint |
| officer B reads officer A's evidence | 0 objects, 0 rows |
| CID reads a **draft's** evidence | 0 objects, 0 rows |
| CID reads it **after sending** | 1 object, 2 rows, Medal flagged |
| CID adds evidence to someone's report | refused |
| CID deletes evidence | 0 rows |

A reviewer can read evidence and cannot plant or remove it. That asymmetry is
the point: evidence is the officer's account, not the reviewer's.

Knip caught `evidenceUrl` unused, which was a real gap rather than dead code —
an officer could attach a file and had no way to open it and check they picked
the right screenshot. It is now an **Open** action that mints a signed URL.

### Patrol can now send intelligence to CID

Second phase of the Field Intelligence portal. P1 established who an external
officer is and proved they can reach nothing; this gives them something to do.

**A submission is a report with parts.** Several people, several vehicles, an
organization, a stash house, a seizure — each stored as its own row rather than
buried in a paragraph, because a reviewer decides about each one separately and
a plate that becomes searchable is worth more than the same plate in prose. Six
tables: `field_submissions` plus persons, vehicles, orgs, locations and items.

**Why not `intelligence_tips`.** It already exists, is empty, and already has a
triage lifecycle and entity links, so reusing it was the obvious move. Two
things ruled it out. Structurally a tip is one flat record and a field report is
not — flattening loses what makes it useful, and widening a tip into a report
distorts the model CID already uses. And `intelligence_tips_ins` requires
`private.is_active()`, so letting a field officer insert one means editing that
policy — which is exactly the pattern P1 identified as how this leaks. **Not one
existing policy is touched here either.** Integration happens at review time
(P4/P6), where accepted claims become tips and links carrying the submission id
as provenance. Nothing becomes intelligence on its own.

**Reviewer-private notes are deliberately absent.** P1 proved a column-level
revoke cannot subtract from a table-level grant, and revoking the table grant
locks out command too. So internal notes are not columns on these tables — they
get their own table with its own policy in P4. Until then there is nothing to
leak.

**Drafts are a status, not a second table.** The draft row is created the moment
the form opens, so a part added before the first save has a parent and a refresh
cannot lose it. Edits autosave a second after typing stops. **A draft carries no
FI number** — numbers are issued at submit, so the series is not full of holes
from reports nobody sent.

**Progressive disclosure.** The form starts as four questions — what, when,
where, your report number. Fields for a person, vehicle, organization, location
or seizure appear only when the officer says there is one. An officer who saw a
car and nothing else fills in a plate and sends it. Nothing is required except a
summary: a vehicle with no plate or a person with no name is still worth having,
and demanding the rest would either lose the report or invite invention.

**Weights keep what the officer typed.** `2.4 lb` stores as `2.4` + `lb`; the
normalized `1088.62 g` is a *generated* column, so the original can never be
overwritten by it. A number without a unit is refused — a bare `2.4` is not a
measurement.

**Direct observation and hearsay are different, and neither means verified.**
Every claim carries `basis`: saw it myself / was told / not stated.

Probed live with two appointed officers and a CID detective, rolled back, with
`GET DIAGNOSTICS` row counts because RLS refuses by matching zero rows:

| attempt | result |
| --- | --- |
| client sends `officer_id`=a detective, agency `LSPD`, callsign `CHIEF` | stored as **the caller, SAHP** — client input discarded, not validated |
| `2.4 lb` | `1088.62 g`, original still `2.4 lb` |
| draft | no FI number |
| submit | `FI-2026-0001` |
| officer edits a sent report | refused |
| officer edits a sent report's vehicle | **0 rows — silent refusal, no error** |
| officer self-promotes to `intel_added` | refused |
| officer inserts a pre-verified report | refused |
| submit with an empty summary | refused by check constraint |
| officer B reads officer A's work | 0 submissions, 0 parts |
| CID reads drafts | 0 |
| CID reviews a draft | 0 rows |
| CID edits the officer's account | refused |
| CID sets `reviewing` | 1 row |
| CID creates a submission | refused — not an appointed officer |

One refusal message was wrong and got fixed: a draft moving to `intel_added` was
told *"a submitted report cannot be edited"*, which is a true refusal and a false
explanation. It now says a draft can only be saved or submitted.

### Field officers — patrol can sign in without becoming CID

First phase of the Field Intelligence Submission Portal: the identity and the
access boundary, shipped on their own because the boundary is the part that can
go wrong quietly.

**The problem this exists to avoid.** `private.is_active()` is just
`profiles.active`, and it is a master key — **22 tables grant SELECT on it and
nothing else**: `persons`, `person_relationships`, `person_vehicles`,
`person_places`, `vehicles`, `gangs`, `gang_members`, `gang_ranks`,
`gang_places`, `gang_turf`, `places`, `place_process_steps`, `accounts`,
`account_handles`, `account_links`, `indicators`, `narcotic_hotspots`,
`narcotic_precursors`, `ballistics_benches`, `ballistic_footprints`,
`commendations`, `tickets`.

So the obvious implementation — give a trooper `profiles.active = true` so they
can file a report — would hand them the entire intelligence database on first
login: every person of interest, every gang member, every stash house.

The other repair, rewriting 45 policies to `is_active() and not
is_field_officer()`, was rejected. It is one forgotten policy away from the same
leak, and a policy nobody thought about would fail **open**.

**So a field officer is not `profiles.active`.** Standing lives in
`field_officers` instead. Not one existing policy was edited, and every CID
table stays shut against them because `is_active()` is false — including tables
nobody remembered to consider. Default-deny by construction rather than by
vigilance.

**Proven, not asserted.** The dedicated `rls-test-inactive` account was
appointed a SAHP field officer inside a transaction and rolled back. As that
officer, **37 tables returned nothing** — persons, vehicles, gangs, places,
accounts, indicators, narcotics, ballistics, cases, evidence, reports, media,
audit_log, siu_memberships, case_charges, legal_requests, observations, targets,
operations, notifications, tickets and the rest. `profiles` returned 1 row —
their own. Those zeros mean something because the tables are not empty: 263
persons, 254 gang members, 60 places, 53 gangs, 22 cases, 238 media.

Writes were probed with `GET DIAGNOSTICS` row counts, because RLS refuses by
matching zero rows rather than by erroring and *no error proves nothing*:

| attempt | result |
| --- | --- |
| insert `persons` / `gangs` | refused by policy |
| appoint another officer | refused by policy |
| change own agency | **0 rows — silent refusal, no error raised** |
| self-activate own profile | **1 row, and `active` still false** — `guard_profile` stripped it; the row count looks like success and is not |
| `assign_field_officer()` | `not authorized` |

**A grant trap worth recording.** The table first carried an `internal_note`
column for command, hidden with `revoke select (internal_note) … from
authenticated` plus a column-list grant. The probe read it anyway: `authenticated`
already held a **table-level** SELECT from the default privileges, and column
privileges only *add* to table privileges — they cannot subtract. Revoking the
table grant worked, and then locked out the column's only intended audience,
since command connects as `authenticated` too. A column with no reader is worse
than no column, so it was dropped. If command notes are wanted later they need a
reader designed alongside them — a SECURITY DEFINER RPC gated on
`is_command()`, not a column grant.

**Dual identity is normal.** An officer who later joins CID keeps the same
account and their old appointment, so historical submissions stay attributed to
the same `user_id`. CID is tested first at the gate, so such a person gets the
investigative portal; `is_field_officer()` only ever grants Field Intelligence
surfaces and can never take a CID surface away.

**What ships.** `field_officers`, `private.is_field_officer()`,
`private.field_officer_agency()`, `assign_field_officer()` / `end_field_officer()`
(command-only, audited, revocation requires a reason and never deletes — the
appointment is the provenance of everything that officer submitted), a
`my_field_standing()` read, a `field` gate state, the `FieldShell` workspace,
and a Command Center section for appointments.

The landing page says plainly that submissions are not open yet rather than
offering a button that does nothing — dead controls teach people the portal is
broken. The submission model is the next phase.

### The 2026 penal code becomes the code in force

The whole penal overhaul was built for this switch. The 2026 code has been
imported and unpublished since `20260904130000`; the portal has served the
legacy 162 statutes, published as a real version so the selectors had a real
published code to read. `20260909120000_penal_2026_in_force.sql` publishes the
2026 code and supersedes the legacy one.

What changes the moment it runs:

| | before | after |
| --- | --- | --- |
| `penal_current_charges()` | 162 statutes | **195** |
| code format | `(1)05` | bare numerics, `109` |
| court / plea / sentencing rules | 0 | **36** |
| controlled-substance schedules | 0 | **3** |
| sentence cap | none stated | 1 limit |

**No case is touched.** Every `case_charges` row carries its own snapshot of
what the code said when the charge was attached, so the 29 existing charge
records keep their legacy offense, class, fine and jail term, and keep naming
*San Andreas Penal Code (legacy)* as what they were charged under. That is the
entire reason the record model was built before this switch was thrown.
Superseded charges also stay attachable, by design — the BEFORE INSERT trigger
refuses a draft but not a superseded version, because historical charges are
real.

**Two charges stay held back, on the owner's instruction.** 195 of 197 are
active. *Possession of a Controlled Substance (Schedule 2)* and *(Schedule 3)*
arrived from the source carrying an unevaluated `=A(n)+1` formula, and both
formulas resolve onto 402 and 403, which already belong to other statutes. The
consequence is stated rather than left to be discovered: **under this code a
person can be charged with possessing a Schedule 1 substance and cannot be
charged with possessing a Schedule 2 or Schedule 3 one.** Both statutes exist
and are readable; `PenalChargeAdmin` can give them numbers at any time, with no
migration and no republish.

**It is applied as a migration rather than through `penal_publish_version()`,
and the audit row says so.** The RPC requires `private.penal_is_admin()` —
`is_owner AND active`, or an unrevoked `penal_administrators` row. The owner who
gave the instruction has `active = false` and a `removed_at` of 2026-07-07, and
no `penal_administrators` row exists for anyone, so the RPC refuses them.
Publishing under the *other*, active owner account was rejected as an option:
attributing a decision to somebody who did not make it is worse than an unusual
audit entry. Nothing about `penal_is_admin()` was relaxed and no profile was
edited to get around it.

Reversible in the product, not just in SQL: `penal_rollback_to()` on the legacy
version restores it and records that the code was *reverted* rather than
advanced.

### The RICO predicate picker stops offering RICO charges as predicate acts

The legacy code designates 18 offenses as RICO predicate acts. **The 2026 code
designates none** — its only RICO rule says the RICO charges are modifiers a
prosecutor or judge adds, and it never names which acts can underlie one.

`RicoTab` filtered on the client `rico` flag, which is the union of *is a RICO
modifier* and *is a designated predicate*. Under the legacy code that gave 24
options and mostly worked. Under 2026 it would have given **six — all of them
RICO modifiers**, so an investigator building a RICO case would have been
offered "RICO Murder (Modifier)" as a predicate act and would not have been
offered Murder. That is the wrong end of the statute.

`penalPredicateOptions()` now answers the question properly: if the published
code designates predicate acts, offer exactly those; if it does not, offer every
non-modifier offense, grouped by class, and say plainly that this code
designates no predicate list. Excluding modifiers is structural rather than a
legal judgement — a modifier is by definition added on top of another charge.

What it deliberately does **not** do is invent a predicate list by carrying the
legacy designations onto their 2026 equivalents. Which offenses qualify is a
decision for whoever maintains the code, and `penal_charges.is_rico_predicate`
is where it belongs: set it there and the picker narrows to it automatically,
with no code change.

The prosecutor-only restriction is unaffected either way — it reads
`snap_is_rico`, set by the trigger from `penal_charges.is_rico`, which is the 6
modifiers under both codes.

Also removed the `(6)01, (6)02` example from the narcotics charge-codes hint.
Code *format* is a property of the published code, not of that form, and the
example became wrong the day a version numbered its statutes differently.

### The anon revoke is made permanent, and TRUNCATE stops being granted

`20260807150000_anon_revoke_hygiene` revoked every privilege on `public` from
`anon`, and the schema snapshot has recorded the result as an invariant ever
since: *"anon holds NO privileges on any table or sequence in public"*. That
was not true, and had not been for months — **53 tables granted anon DELETE,
INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE and UPDATE**, including every SIU
table, every surveillance table, the whole penal code, and `case_charges`.

The revoke was a one-time cleanup that never touched `pg_default_acl`, which
still read `arwdDxtm` for anon on tables created in `public`. Every table
created after 2026-08-07 was therefore born with full anon DML again, silently,
and would have gone on doing so forever. Cleaning up without changing the
default is a treadmill; this migration does both.

**Nothing was exposed, and that was verified rather than assumed.** Reading
each affected table as `anon` returns 0 rows or a hard permission error,
because every policy resolves through `auth.uid()` and no policy targets anon
at all — 0 of them do. RLS held throughout. The gap being closed is between
the documented state and the real one.

The one exception worth naming is TRUNCATE: it is **not** subject to row-level
security — RLS governs SELECT, INSERT, UPDATE and DELETE and nothing else — so
"the policies deny everything" is not an argument about it. It is not reachable
through PostgREST, which has no TRUNCATE verb, so it was not exploitable, but
it was a privilege with no backstop and no purpose. It is revoked from
`authenticated` too, along with TRIGGER and REFERENCES, leaving exactly the
four DML privileges the policies actually govern. No TRUNCATE was executed
against the live database to prove any of this.

After: `anon` holds 0 table privileges and is gone from the default ACL
entirely (`{postgres=arwdDxtm/postgres, authenticated=arwdm/postgres,
service_role=arwdDxtm/postgres}`); `authenticated` holds 0 TRUNCATE grants and
still holds 137 SELECT and 124 INSERT. A detective reads the same rows as
before — cases 15, persons 258, evidence 3, `case_charges` 26, penal charges
162 — so nothing legitimate depended on what was removed.

The snapshot's grant section is rewritten from live state rather than patched:
the false invariant, 55 `authenticated` grant lines, 67 `anon` lines, and the
two tables that are not standard (`notifications`, `profiles`).

### `case_charge_transition_ok()` gets its search_path pinned

Supabase's advisor flagged `function_search_path_mutable` on one function, and
it was mine: `20260905130000` gave `set search_path to ''` to
`case_charge_may`, both triggers and `case_charge_court_read`, and missed the
transition table.

It could not have returned a wrong answer — the body is two string comparisons
against literals, calling nothing and reading no table, so there is no
unqualified name for a caller's `search_path` to capture. It is fixed anyway,
because a function with a mutable search_path is one edit away from mattering,
and an advisor with a known exception in it stops being read. Same signature,
same 9 edges, verified unchanged.

### The two codeless charges can be given their numbers

The 2026 code has been imported and unpublishable-as-complete since it landed:
2 of its 197 charges arrived with an unresolved spreadsheet formula instead of
a number, and a charge with no code is held out of every selector. Nothing
could assign one, because `penal_restore_charge()` had no caller.

`PenalChargeAdmin` sits under each version in the administration panel and
shows the two things that can be wrong with a statute — **awaiting a code**
(held back, cannot be charged, makes the version incomplete to publish) and
**retired** (archived, still resolvable by cases that charged it). Both are the
same RPC, because both are the same act: make this charge selectable again.

Retiring a statute is there too, behind a search rather than a button on all
162 catalog rows — it is rare, deliberate, and needs a reason for the audit
log. Nothing is deleted: an archived charge stays readable so a case that
charged it can still resolve what it charged.

**The collision check explains rather than just refusing.** Typing 402 for the
Schedule 2 possession charge is exactly the assignment the import declined to
make by inference, and an administrator doing it by hand hits the same wall —
`penal_charges_code_unique (version_id, code)`. The client says *"402 already
belongs to Possession with Intent to Sell in this version"* before the round
trip; the constraint is still the guarantee, and a collision the client misses
fails in the database.

No code is suggested. Which number a statute carries is the administrator's
decision, and the reasoning that refused to infer 402/403 during the import
applies just as much to a helpful default now.

Verified live, rolled back: a detective is refused (`not authorized`); a blank
reason is refused; 402 is refused by the unique constraint; and assigning two
free numbers drops `needs_code` to **0** — which is what makes the 2026 code
publishable as a complete code. The real assignment is left to a person.

### Charges on a case become the records they always should have been

`case_charges` shipped with the data layer and nothing rendered it. The Charges
tab still read and wrote `cases.charges`, the jsonb array — so the status lane,
the snapshots and the RICO restriction all existed and none of them were
reachable. That is now the tab.

Each row shows its own snapshot: the offense, class, sentence and fine as the
penal code read **when the charge was attached**, with the version named
underneath. The figures come from `case_charge_totals()` rather than being
summed in the client, because the database is the only place that knows which
rows a given viewer may see. A judge-set term is reported separately —
`120 mo + 1 for a judge` — never folded in as zero.

The lane is visible: each charge offers only the moves its status allows, and
every button is labelled with who performs it. **An action can be visible and
still be refused**, deliberately — the alternative is a client that quietly
holds a second copy of everyone's authority, which is exactly what drifts. So
each move re-reads the row afterwards and checks the status actually changed:
RLS refuses by matching zero rows, not by erroring, so "no error" proves nothing
and a silent no-op would otherwise report success.

`CaseDetail`'s charge badge and the case packet move across too. The packet no
longer resolves codes against the current catalog at all — it reads each
record's snapshot, so the `(unknown)` fallback that used to appear when a
statute was renumbered is now unreachable, and the export cannot race the
catalog load. It also states each charge's status, because a disclosed document
listing a withdrawn charge as if it were live misstates the case against
somebody.

### The legacy jsonb path is removed, not just bypassed

`parseCharges`, `CaseCharge`, `PenalTotals` and `penalTotals` are gone with the
column's last reader. `cases.charges` itself is untouched and keeps its history;
nothing in the client reads or writes it.

Deleting `penalTotals()` was the point rather than tidiness. It resolved stored
codes against the **published** catalog, so the moment a new version is
published, every case charged under the previous one would have totalled to
`0mo / $0` — no error, just a wrong number on screen. A helper that returns a
confident zero when it cannot resolve anything is worse than one that is
missing.

**Controlled-substance capture is built and dormant.** The fields, the
constraint and the UI are all in place, and verified: recording a quantity
against a charge the code does not schedule is refused. But the legacy code
currently in force schedules nothing — `penal.ts` never carried schedule
numbers, and only the 2026 import does (401/402/403 → Schedules 1/2/3). The
capture appears when that version is published, and not before.

### The penal code can finally be published by a person

The publish, rollback, archive and restore RPCs have existed since the data
layer landed and **nothing had ever called them**. That was not a cosmetic gap:
the 2026 code sat imported and unpublishable, because publishing requires an
authenticated administrator and no screen offered the action.

`PenalAdminPanel` is that screen — versions with their status and counts,
publish, and roll back to a superseded version. It renders only for a Penal
Code administrator, and it does not decide that itself: `penal_admin_overview()`
reports `is_admin` from `private.penal_is_admin()`, the same helper every penal
policy uses. Every action behind it is a SECURITY DEFINER RPC that re-checks the
same thing, so hiding the panel is tidiness rather than the boundary.

**The obvious way to detect an administrator is wrong.** `penal_admins_sel` is
`USING (private.penal_is_admin())`, and that helper is
`is_owner() OR an appointed administrator`. The Portal Owner is an administrator
*without having a row* in `penal_administrators` — and today no administrator
has ever been appointed, so the table is empty. A client inferring adminness by
reading it would have hidden the publish button from the only person entitled to
press it.

**Publishing is spelled out rather than confirmed.** The step says what will
happen: every unit reads the new code immediately, the version in force is named
and will be superseded, charges already on a case keep their own snapshots — and
the one that is easy to miss, that a version carrying codeless charges publishes
an **incomplete** code, since a charge with no code reaches no picker. The 2026
draft has exactly 2 of those. A reason is required for a rollback and optional
for a publish, matching what the RPCs demand.

After either action the client re-fetches the statute catalog before reporting
success, because every other screen is still holding the code that was in force
a moment earlier.

Verified live in a rolled-back transaction: a detective is refused
("not authorized"); the owner publishes 2026 and the force immediately sees 195
charges with 36 rules and 3 schedules instead of 162 with none; the owner rolls
back and it returns to 162. Live state is unchanged — legacy remains in force
and 2026 remains a draft, which is still a decision for a person to make.

### The penal code stops being compiled into the app

`src/lib/penal.ts` *was* the penal code: a 162-entry array converted from the
vanilla `penal.js`. That array is gone. The statutes now come from
`penal_current_charges()` — the published version, whatever it is — and the file
is a cache over it. Verified: the statute text no longer appears anywhere in the
built client bundle.

A constant in a JS bundle has no version, no audit and no RLS. Amending a fine
meant a deploy, every unit ran whatever build it was served, and a case could
not record which code it was charged under. Keeping a fallback copy would just
be a second penal code that silently disagrees with the first, so there isn't
one.

**The `PENAL_CODE` export is gone deliberately.** A module-level array that
fills in later is a trap: anything reading it at import time captures it while
empty and stays empty forever. `narcoticsDossier.ts` did exactly that —
`new Map(PENAL_CODE.map(...))` at module scope — and would have resolved every
charge code to null for the life of the page. Every read now goes through
`penalCatalog()` or `penalByCode()` at call time, so that mistake is no longer
available to make.

**Nothing is rendered before the catalog arrives.** Until it loads,
`penalByCode()` returns null and `penalTotals()` sums to zero — so a case
carrying 60 months would read "0mo / $0" and a RICO case would show no
predicates. Those are lies, not approximations. `usePenalCode()` reports
readiness, PenalView says it is loading rather than showing an empty statute
book, ChargesTab withholds the sentence, fine and predicate figures behind a
dash, and `gatherCasePacket()` awaits the catalog outright — a packet is filed
and disclosed, so it must never go out with bare codes and no penalties.

### The code that was already in force is recorded as in force

The database said no version was published while the application served 162
statutes to everyone. Those cannot both be true. The legacy code was imported as
`superseded` when it existed only to give historical charges something to
resolve against, but nothing had superseded it.

Publishing it corrects the record and changes nothing any user sees: the
statutes now served by `penal_current_charges()` were verified byte-identical to
the array they replace, by an md5 over every field computed against
`src/lib/penal.ts` and again in the database. It also had to happen before the
selectors could move at all — `penal_current_charges()` reads
`where status = 'published'`, so with none published, pointing the UI at it
would have emptied the penal code rather than moved it. Teaching the query to
fall back to the newest non-draft version was rejected: that hides the absence
of an enacted code, which is the one thing the status column exists to show.

The 2026 code stays a draft. Publishing it changes the law in force and is a
decision for an administrator, not a side effect of a deployment.

### The RICO predicate picker nearly lost 18 of its 24 entries

`penal_current_charges()` returned `is_rico` only. The old array carried a
single `rico` flag covering 24 charges, and three surfaces read it: the
predicate-act picker, the catalog badge, and the per-case predicate count.
Splitting that flag into `is_rico` (6 modifiers) and `is_rico_predicate` (18
predicate-eligible offenses) was correct — they are opposite ends of the same
statute — but the read surface only ever exposed one half. Cutting the client
over as-is would have shrunk the picker to 6 and quietly stopped counting
Murder, Kidnapping, Robbery, Arson and Bribery as predicates on every RICO case.
The UI would have looked fine. Both columns are now returned and the client flag
is their union, which is what those three surfaces have always meant.

### A charge on a case becomes a record, with a snapshot and a status

`cases.charges` was a jsonb array of `{code, count}`. Five things were wrong
with it, and none were cosmetic. No identity, so nothing could reference "this
charge on this case" — not an audit row, not a court decision. No status, so a
charge an investigator was merely considering and one a judge convicted on were
the same shape. No snapshot, so the code resolved against whatever the penal
code said *now*, and amending a fine retroactively changed what a case appeared
to have charged. Every add and remove rewrote the whole array, so two people
editing one case silently discarded each other's work. And no authority: any
writer of the case row could set any charge, including the RICO modifiers the
code reserves to a prosecutor or judge.

`case_charges` fixes each. The snapshot is written **by the database** — a
BEFORE INSERT trigger overwrites every `snap_` column from `penal_charges` and
discards whatever arrived, so a client chooses *which* charge while the database
decides what that charge *says*. Verified by sending a deliberately false
payload: offense "Jaywalking", class Infraction, fine 1, jail 1, status
convicted. What landed was `(1)09 Attempted Murder, Felony, $110,000, 60 months,
proposed`.

The status lane is proposed → under review → approved → filed → convicted /
dismissed, with withdrawal available at every pre-court stage and none after.
Approval and filing route by lane, because **SIU never uses a CID Bureau Lead or
a prosecutor queue**: a CID charge is approved by a Bureau Lead and filed by a
prosecuting attorney, an SIU charge by X-1 and the Attorney General. Nobody
approves their own proposal. There is deliberately no delete — a charge that
should not have been brought is withdrawn, which keeps the record that it was
brought, and somebody wrongly charged is entitled to that showing.

A transition rule is a statement about the pair (old status, new status), and an
UPDATE policy cannot see both — `USING` tests the old row, `WITH CHECK` the new,
and nothing correlates them. So authority for a *move* lives in a trigger while
RLS decides who may touch the row at all. Both must pass. RLS is not weakened;
it is doing the part it can express.

### A charge could be filed and convicted by anyone with no justice role

Found in the migration above, before it shipped, by asserting row counts instead
of the absence of an error. `private.justice_role()` is NULL for every CID user,
so `NULL in ('prosecutor', …)` is NULL, `not NULL` is NULL, and
`if NULL then raise` never fired. The guard passed for exactly the people it
exists to stop: a detective could move their own case's charges to filed,
convicted or dismissed — recording a conviction with no court involved.

It read as correct and it *tested* as correct against a real Attorney General,
because a non-null role compares FALSE rather than NULL. Only a caller with no
justice role at all opened it, which is the one case a justice-role test
naturally forgets to try. Both sites now force two-valued logic at the boundary
rather than patching call sites, so a future caller cannot reintroduce it.

### The legacy penal code is recorded as the superseded version it is

The 29 charges already on 6 cases all carry old codes — `(1)09`, `(4)22`,
`(10)01` — that do not exist in the 2026 import. They were charged under a
different penal code, and that code was real. Freezing them as snapshots needs a
version to belong to, or the reference is either a nullable foreign key that
later code forgets to check, or a wrong 2026 charge that silently restates what
a case charged.

So all 162 legacy charges are imported as a `superseded` version, generated
mechanically from `src/lib/penal.ts` by a script that aborts rather than guesses
— it fails unless the file yields exactly 162 charges in 14 fields each with no
non-ASCII surviving normalisation. Verified by digest: an md5 over every field
computed locally and again in the database matched exactly.

Three legacy facts would have been destroyed by a naive mapping. **Capital** is a
real class for 8 charges; folding it into Felony would misstate what they are, so
the constraint was widened. **`rico`** means the opposite of what it means in
2026: legacy marks 18 RICO *predicate* offenses (Murder 1st, Kidnapping) while
2026's `is_rico` marks the six Title 12 *modifiers* only a prosecutor may add —
collapsing them would put Murder on the prosecutor-only list *and* empty the
predicate picker that reads the flag today, so they are now separate columns.
**`arrest_required`** covers 11 charges needing an arrest rather than a citation.
Both new columns are nullable on purpose: null on a 2026 row means "this version
does not say", which is true, where false would have the 2026 code positively
asserting that Murder is not a RICO predicate.

The 29 existing charges are migrated as `proposed` with `added_by` NULL. Both
are deliberate understatements — the old model recorded no status, no author and
no date, so marking them filed would assert a court event that may never have
happened, and attributing them to whoever ran the migration would put a name
against an act that person may not have performed. Each row says so in its note.
`cases.charges` is **not** modified: the portal still reads it, and the selectors
move in a later step.

### The Penal Code becomes data, shared by every unit

It was a hard-coded TypeScript array — 162 charges compiled into the bundle,
with charges landing on a case as `cases.charges` jsonb: a code string and a
multiplier, nothing else. That shape cannot carry what a penal code needs. No
version, so an amendment silently rewrites history. No snapshot, so a fine
changed today changes what a case filed last month appears to have charged. No
status, so a proposed charge and a conviction are the same row. No audit, no
schedules, and nothing enforceable in the database at all, because a constant
in a JS bundle has no RLS.

This is the data layer: versions, charges, controlled-substance schedules, the
court and plea rules, and the machine-readable sentencing limits — one central
dataset that CID, SIU, JTF, DOJ, the AG, prosecutors and judges all read,
because a penal code that differs by unit is not a penal code. Reading it
grants nothing else: these tables reference no case, person or unit, so a
shared charge cannot become a path into another unit's records. That is
structural, not a policy that could drift.

**The visible code is deliberately not the primary key.** Every charge gets a
stable uuid; the code is unique only within a version and only when present.
All three reasons are real in the 2026 source: 31 rows arrived with no code at
all, codes are renumbered between versions, and a future source may repeat one.

**The codeless rows are resolved by reading the formula, not by guessing.**
The Code column exported unresolved spreadsheet formulas — `=A147+1` says "one
more than the row above", which is the author's intent, not an inference about
it. 29 of the 31 evaluate onto free numbers: Title 7 from Street Racing (705)
through Illegal Dumping (733), an unbroken run starting from Reckless Driving
at 704 and ending before Title 8 begins at 801. Those are imported active, each
carrying in its `special_notes` the fact that the code was derived and which
formula produced it, so a reviewer sees a computed number rather than a
transcribed one.

The remaining 2 fail on arithmetic, not caution. In document order Title 4 runs
401 (Schedule 1), then the two unresolved rows, then 402 and 403 — so
evaluating their formulas produces 402 and 403, which already belong to
Possession with Intent to Sell and Sales. `penal_charges_code_unique` refuses
the assignment outright. The Schedule 2 and 3 possession charges are imported in
full as `needs_code` drafts, which the SELECT policy keeps out of every selector
until a real code is assigned. Putting the wrong number on a narcotics
possession charge is the one error here worse than a missing charge, because the
number is what gets filed.

Two source conflicts are recorded rather than silently resolved: 214 Possession
of Burglary Tools has a Stackable column of N and a definition ending
"STACKABLE" (imported as stackable, disagreement written into the row), and 516
Prison Break has "MAX ORIGINAL" instead of a jail number. Eight judge-set
charges store NULL with a flag — a distinct state from zero, enforced by
constraint, so a total can never quietly count "a judge decides" as nothing.

Nothing in the running portal changed. `cases.charges`, `src/lib/penal.ts` and
every existing selector are untouched, and the imported version is a **draft** —
publishing is a separate audited act, not a side effect of a deployment.

All 197 charges are now in the database and were verified field by field
against the source after loading, not before: 195 coded with no duplicates, 2
held back for codes, 8 judge-set, 33 in Title 7, plus the 3 schedules, the
200-month limit and 36 rules.

### An unpublished Penal Code draft was readable by the whole force

Found by probing the import, not by reading the migration that caused it. The
data layer gated `penal_charges` on version status and, by omission, gated
nothing else — `penal_substance_schedules`, `penal_rules` and `penal_limits`
each carried `is_active() or penal_is_admin()` with no version test at all.
While those tables were empty the gap had nothing to leak and read exactly like
a working gate. Loading the 2026 code filled them, and a role simulation as an
ordinary detective returned charges=0 — correct — alongside schedules=3,
rules=36 and limits=1 from the same unpublished draft.

That is a disclosure, not an inconvenience: these tables are on PostgREST like
any other, so the UI declining to render a draft proves nothing. The rules carry
the plea, court and hard-limit text and the schedules say which substance sits
in which tier, which is the input to a narcotics charging decision. A draft is
law that is not in force; being able to read it early makes publishing partly
meaningless, and an officer charging from a draft schedule has charged from
something that is not the law.

All four content tables now share one predicate, written identically rather than
abbreviated, so they cannot drift apart while still reading as correct. Verified
both ways on the live database: a detective sees nothing of the draft, an
administrator still sees all of it — and in a rolled-back transaction that
published the version, the gate opens, 195 charges reach the selector and the
two codeless drafts stay out. A gate that never opens would be a different bug
wearing the same green tick.

### A stalled legal request now says who can move it

"This request is awaiting Bureau Lead review" was true and useless. It never
said *which* Bureau Lead, and it was silent on the commonest way a CID request
stalls: nobody may approve their own request, so a Bureau Lead who raises one in
their own bureau is waiting for themselves — with nothing on screen saying so.

The explanation now names the responsible bureau's Bureau Lead, the Deputy
Director / Director who can stand in, and the JTF widening, and it tells the
author plainly when the person the lane would route to is them.

**And when command does stand in, the record says so.** Approval already worked
out whether the approver was the bureau's own lead or a substitute, but wrote
that only to the restricted audit log — the request's own timeline showed a bare
"CID approved". The audit log answers "what happened, for an investigator of the
system"; the timeline answers "what happened, for a participant in this
request", and who authorised a warrant is squarely the second question. A
`command_fallback` entry now appears on the timeline naming the substitution.

That fact is captured at decision time rather than derived later. Computing it
in the client from the reviewer's *current* role and division would retroactively
turn every past LSB approval into a "fallback" the day that Bureau Lead
transfers to BCB.

### SIU actions live on the person's own record

An agent reads a profile, decides the person matters, and — before this — had
to leave, find the SIU tab, open a form and search the registry for the record
they were already looking at. Every one of those steps was a chance to type a
name instead of attaching the record, which is exactly how the unit ended up
with a duplicate address book in the first place.

A person's profile now carries an SIU bar: current watch, designations,
intelligence count, and a registered-source warning, with **+ Watchlist**,
**+ Designate**, **+ Intelligence** and **Open dossier** beside them. The
subject is already chosen and cannot be mistyped.

It renders nothing for anyone without SIU field standing — not because the
buttons would fail (the RPCs all gate server-side) but because their presence
on a shared CID registry page would tell any detective that the unit exists and
takes an interest in people. The status line is read from
`siu_person_dossier()`, which is SECURITY INVOKER, so a caller who cannot see a
watch is told there is none; nothing is filtered down in React because there is
nothing broader to filter.

The registered-source warning is stated in a sentence rather than a chip,
because targeting somebody else's source is the mistake §19 deconfliction
exists to prevent and a chip is too easy to skim past.

### SIU legal requests take the SIU lane, and stop telling CID about it

The legal pipeline was built for CID and had no SIU branch at its two front
stages. Submitting an SIU warrant notified every CID `deputy_director` and
`director` — four accounts here, the Director of CID among them, who holds no
SIU authority and has to ask X-1 for sight of a single case.

That was a disclosure, not noise. `private.legal_notify()` puts the request
number, the type and the **title** into the notification payload for any
non-sealed request, so the substance of an SIU legal request was being pushed
to people who could not open it and were not entitled to know it existed.

It then got worse quietly: `legal_resolve_bureau()` stamps an SIU case with a
CID bureau (the live SIU case already carried `originating_bureau = 'SAB'`),
X-1's approval sent it to that bureau's **prosecutor queue**, and
`can_view_legal_request()` handed those prosecutors sight of it — the rule
"SIU never uses a CID prosecutor queue" broken by the default path, with no way
for an agent to avoid it. And there was no AG hop at all.

The chain is now Special Agent → X-1 → Attorney General → Judge. Two new
stages (`siu_command_review`, `returned_by_siu_command`) so an SIU warrant
never displays "awaiting CID supervisor review", wording that is simply false;
SIU branches inside the existing RPCs rather than parallel copies; and the
bureau-scoped CID prosecutor lanes closed to SIU requests. The AG and Judge
branches are kept, because they are the SIU lane's own next stops.

Measured live, in a rolled-back transaction:

| | before | after |
|---|---|---|
| SIU submit → notified | 4 CID command | **1 — X-1 only** |
| X-1 approves → goes to | `prosecutor_queue` | `ag_review`, AG notified |
| **CID control** submit | 4 notified | **4 — unchanged** |

**Two bugs the probe caught that review had not.** X-1's approval called
`legal_sign()` with an action the signature constraint did not know, so the
whole approval rolled back — and signing as `cid_supervisor_approval` instead
would have passed silently and put the wrong words on the record of who
authorised an SIU warrant. And `can_edit_legal_draft()` had never heard of
`returned_by_siu_command`, so the new return path was a dead end: X-1 sends a
warrant back and the agent cannot touch it. Both were found by probing the
*return* path rather than only the happy one.

Authority was already correct and is unchanged — `can_approve_legal()` has had
an SIU branch since it was written, so no unauthorised person could ever
*decide* an SIU request. They were merely told one existed and it was routed to
the wrong bench.

The workflow engine learned the lane too, so "why is this stuck" on an SIU
request now says who holds it and where it goes next — including that the
prosecutor queue is *not* the next stop, which a reader who knows the CID
pipeline would otherwise reasonably assume.

### Targets and Intelligence can finally be created

Both tabs could read, grade, review and clear — every verb except the one that
puts something there in the first place. `siu_targets` had no create RPC and no
action on its screen, so the table was empty; `siu_case_notes` had an INSERT
policy with nothing reaching it. An empty table for a feature the unit needs is
not a clean slate, it is a feature nobody could use.

`siu_designate_target()`, `siu_clear_target()` and `siu_record_intelligence()`
close that, and the screens now lead with **+ Designate a target** and
**+ Record intelligence**, with empty states that say what to do next.

**Designating names a record, not a string.** `siu_targets` carried the same
untyped `entity_id` and copied `label` the watchlist just shed, so it gets the
same six typed foreign keys and the same constraint pinning the reference to
`entity_type`. It was verified empty before the migration was written rather
than assumed — the previous one made that assumption and failed on apply.

Three rules the designation workflow enforces because each is a real mistake:
the subject must exist in the registry; there is **one live designation per
subject per investigation**, so "what is their standing?" cannot have two
answers; and `cleared` cannot be an *opening* designation, because it is an
outcome and opening one would assert the unit looked when it never did.
Clearing keeps the row, the reason and who lifted it — somebody wrongly
designated is entitled to the record showing they were cleared, and the unit
needs the record that it once thought otherwise.

**Recording intelligence says which case it is about, out loud.** A note against
a CID investigation is invisible to that investigation's own detectives and to
CID command — that is the feature, and the author is now told so before they
save rather than left to infer it. Grading is offered at authorship because
that is the only moment it can be set; leaving it blank is legitimate and the
note is then shown as ungraded, which is the honest state. A review date is set
only for graded intelligence: scheduling a review of something nobody has
assessed would put a meaningless date on the calendar.

`siu_record_intelligence()` is SECURITY DEFINER only because
`private.siu_audit()` is not executable by `authenticated`, so it restates
`siu_case_notes_ins`'s check verbatim and both are documented as a pair that
must change together. It never writes the review columns — creating a note is
not reviewing it — and the note body is never copied into the audit detail,
since the audit log has a wider readership than the note.

The registry picker built for the watchlist is now shared by target designation
rather than duplicated, so neither screen can drift back towards a free-text box.

### The SIU watchlist points at CID's records instead of copying them

`siu_watchlist` was built with an untyped `entity_id` carrying no foreign key
and a `label` holding a copy of the subject's name. That is a second, worse
address book: correct a name in CID and the watchlist keeps showing what was
true on the day somebody typed it.

It was not hypothetical. The table held one entry created by a live user — a
watch declared to be on a *person*, with no person attached, just the typed name
`tobi butler` — while that person already existed in `persons` as a Person of
Interest with a recorded gang affiliation. None of that reached the watchlist.

Every entry now references a canonical record through a real foreign key
(`person_id`, `vehicle_id`, `gang_id`, `place_id`, `account_id`,
`indicator_id`), with a constraint requiring exactly one and pinning it to
`entity_type` so the two cannot disagree. The name is read through the link on
every read. The add form searches the registry instead of offering a text box;
typing a name is possible only by explicitly choosing "not in the registry",
which creates an unidentified stub to attach later. Partial unique indexes make
"already on the watchlist" a database fact rather than a UI check somebody can
race. `organization` was dropped — it had no table to point at, so no watch of
that type was constructible.

The existing row was backfilled to its registry record by exact name (audited);
anything ambiguous would have been demoted to `unknown` rather than guessed at,
because attaching a watch to the wrong person is worse than leaving it
unattached.

**Two things this quietly broke, found and fixed in the same pass.**
`siu_watch_remove()` wrote `status = 'removed'`, a value the new vocabulary
refuses — every removal would have failed at the database. And `siu_deconflict()`
matched watches on `label` and on `status = 'active'` alone, so a *correctly
linked* watch, or one stepped down to monitoring, vanished from the one check
whose job is to stop two agents burning the same operation: the better the data
got, the more the safety check missed. Deconfliction now resolves a name through
the registry and counts all four live statuses, and the same widening was
applied to the `watch_active` / `watch_expiring_14d` figures on the command
dashboard and the oversight report.

### A person dossier, assembled from the registries

`siu_person_dossier()` is what the reference was for: one subject gathered live
across persons, gangs and memberships, registered and observed vehicles,
locations, online accounts and handles, associates, narcotics, surveillance, and
the unit's own watch, targets and intelligence.

It is **SECURITY INVOKER** — the only SIU RPC that is, and deliberately. It
performs no action, so it runs as the caller and each of the fifteen tables it
reads is filtered by its own existing policy. It restates no rule, so it cannot
disagree with one. An unauthorized caller therefore gets no error, just the
registry half and empty SIU arrays; the UI says "none you can see", never "none
exists". Verified live: X-1 sees the watch and its history, a CID detective
calling the same function on the same person sees the person and zero SIU rows.

Fact and intelligence are shown apart using the columns the registries already
keep — `link_status`, `confidence`, `provenance`, `ownership_confidence`,
`verification_status`. A vehicle registered to the subject and a plate an
informant mentioned are both there, and the record says which is which. A
registered informant appears as codename and status only, so an agent cannot
target somebody else's source by accident without learning anything about how
that source is run.

Each tab's primary action is now on the tab: **+ Add to watchlist**, a review
that records what was decided, and an empty state that says what to do next
rather than only that there is nothing there.

### The Director of CID can ask X-1 to see one investigation

He is the unit's nominal boss and hands-off: no standing, no caseload, no
appointment authority. When he needs sight of a specific investigation he
requests it **by case number** and X-1 decides.

The hard part is enumeration. Because he sees no caseload, the form cannot
validate the number — "unknown case" versus "submitted" would let him walk the
case-number space and learn how many investigations exist and when each opened.
So the number is stored as free text and never resolved at request time; X-1
resolves it at decision time, and a request for a case that does not exist ends
`denied`, worded identically to a real case being refused. He learns nothing
from a refusal.

Approval issues a §30 `siu_temporary_access` grant, so it inherits those bounds
unchanged: one case, case file only, standard classification only, time-boxed,
revocable, audited, and beaten by the §17 recusal veto. A compartmented
investigation cannot be opened this way even by X-1 approving.

Verified live: real and fabricated case numbers accepted identically; after
approval he sees the granted case and its reports, and **zero** rows from
`siu_case_notes`, `siu_targets` and the watchlist; standing stays `null`
throughout; total visible SIU caseload is exactly the one granted case.

The request card lives on his own My Desk, because with no standing he cannot
reach the SIU workspace at all. X-1's decision queue sits in the SIU Intake
section.

### CID Director no longer holds SIU authority — reversing the SOP chain change

Migration `20260823120000` read the unit's SOP as seating the **Director of
CID** in the SIU chain and gave every active `role = 'director'` profile
oversight standing ex officio. The final organisational model removes that:
SIU's chain is **Attorney General → X-1 → Senior Special Agent → Special
Agent**. CID command is powerful inside CID and does not command SIU.

This matters more than a label. Oversight standing is not passive —
`siu_can_appoint()` includes it, and `siu_remove()` lets an oversight holder
**end an X-1's membership**. Under the old rule the Director of CID could
dissolve the unit investigating CID. No amount of read-side compartmenting
fixes an inversion at the appointment layer.

Exactly one branch is deleted from `private.siu_standing()`. Unchanged: the
**Attorney General** keeps ex-officio oversight (the AG *is* the reporting
line), `profiles.is_owner` still resolves to `owner`, and an explicit
`siu_memberships` row still confers standing on anyone — a Director genuinely
appointed to SIU keeps it. Appointment is now the only route in for any CID
rank.

Live effect, verified: the serving Director of CID drops from `oversight` to
`null` and SIU ceases to exist for them. A second director-role account carries
`is_owner` and is unaffected, because that branch is evaluated first and is
gate-independent.

Seven unit tests encoded the old model and failed as soon as the branch went —
they did exactly their job. All seven now pin the new chain, including a
dedicated "leaves the Director of CID entirely outside the chain" case.

### DELETE was the one write the CID↔SIU wall never covered — closed

Found while giving the SIU workspace CID's full navigation. **Pre-existing**,
and it affected every SIU member.

`private.can_delete()` is a raw rank check — `role in ('bureau_lead',
'deputy_director','director')` read straight off the profile. No case, no
department. `can_delete_case_child()` used it verbatim for the CID branch, with
no case predicate. Inside CID that is invisible, because command reaches every
CID case anyway. Across the departmental wall it was wide open: an SIU member
cannot edit a single field of a CID case, but one holding a CID command rank
satisfied `can_delete()` — and DELETE never consults the write wall.

Probed live as a real Special Agent in Charge with CID rank `bureau_lead`:
`can_access_case(cid case)` **false**, `can_delete()` **true**, and a CID
report, task and RICO case all deleted. Both appointed SIU members hold a
qualifying rank. (The case row survived — `cases_del` has always paired the two
correctly, which is exactly the shape the children were missing.)

The CID branch is now `can_delete() AND can_access_case(p_case)`. **No CID user
gains or loses a single delete**: every rank `can_delete()` accepts is command,
and `can_access_case()` admits `is_command()`, so the term is always true for a
CID member on a CID case. Verified both directions live — SIU blocked on
report, task, RICO and predicate acts; the CID Bureau Lead unchanged at 1 row
each. A null case id now returns false instead of falling through to true.

`rico_cases_del` / `predicate_acts_del` were never routed through the chokepoint
and joined it here. `tests/rls/v170.test.ts` pins the whole thing, with a CID
Bureau Lead as the control so a future fix that costs CID a delete fails loudly.

### RICO now reads on the SIU read superset

`rico_cases_sel` and `predicate_acts_sel` were on `can_access_case()` — the
write wall — while every other case child moved to `can_read_case()` back in
Phase 1. RICO was missed, so an SIU agent could read a CID case's reports,
evidence, media and tasks but see zero of its RICO records. SELECT only; every
write stays on the wall. `case_messages` remains the one deliberate exclusion.

### SIU navigation reaches all of CID

Following on from the Cases entry: the SIU workspace now carries CID's entire
navigation, tab for tab — Command, Cases (with operations, legal, RICO),
Intelligence (all fourteen registries and analysis screens), Reference and
Oversight. That is navigation, not access. Shared registries (persons, gangs,
places, vehicles, accounts, indicators, media) are one master dataset and SIU
reads and writes them exactly as CID does; case surfaces are read-only under
the SIU read superset; owner- and command-only screens self-gate exactly as
they do for a CID detective without the rank.

### SIU can reach CID cases without switching department

SIU's broad read of CID has existed in RLS since Phase 1 —
`private.siu_oversight_read()` feeds `can_read_case`, and an SIU agent could
already see every CID case, report, evidence item, media file and task. There
was simply **no route to it**: the SIU navigation had no Cases entry, so an
agent had to switch department to look at a Division case, and only the Owner
and the Attorney General can even do that.

The SIU workspace now has a **Cases** category (`cases`, `case-files`). This
adds navigation, not access — verified live: an SIU agent sees 21 cases (their
own investigation plus all 20 CID ones) while a plain CID detective still sees
7 and **zero** SIU cases. `operations` is deliberately left out: the SIU
workspace has its own Operations section, and two routes to two different
operation concepts under one label is how a workspace stops being legible.

**The part that mattered more than the nav.** Every write an SIU member
attempts against a CID case is refused by RLS matching **zero rows**, not by
erroring — `can_access_case()`'s CID branch ends with
`not private.is_siu_department()`. So the Edit, Archive and New Case controls
were rendering and *silently doing nothing*. A control that appears to work is
worse than an absent one, and adding the nav entry would have exposed that to
every agent.

`useSiu().caseReadOnly(caseRow)` now narrows `canEdit`/`canDelete` in the case
screen, and the cases list withdraws create and bulk-archive in the SIU
workspace. It mirrors exactly the two places the server refuses outright — an
SIU department member on a CID case, and oversight standing on an SIU
investigation — and nothing else: it narrows, never widens, and is inert for an
ordinary CID member. Per-case membership facts are deliberately not modelled,
because the client cannot know them and guessing would either hide a control
someone has or show one they do not.

In the SIU workspace the list also carries an **Authority** column, since the
two departments now appear together and the difference decides whether the
viewer can do anything with a row.

*Recorded, not fixed:* `private.can_create_case()` never excluded SIU
department members, so the INSERT itself is still permitted — the case is
forced to `case_authority = 'cid'` by the guard trigger and its creator then
loses access to it. The UI withholds the control; changing the function touches
CID's own create path and is a separate decision.

### SIU intelligence quality, watchlist, deconfliction and supporting access (§19, §20, §21, §23, §25, §30, §35, §36, §53)

**§20/§21 — grading asks two questions.** The unit already graded SOURCES; it
never graded the INFORMATION. Those are different questions, and collapsing
them is the classic intelligence failure — a reliable source can pass on a
rumour, and an untested source can be right. A note now carries both halves of
the Admiralty pairing plus how it was obtained.

**Ungraded is a real state.** All the new columns are nullable with no default,
and `review_due_at` deliberately has none: `add column … default` backfills
existing rows in modern Postgres, which would have stamped a review date on
every note already written and made it look assessed when nobody had looked.
Nothing anywhere treats a missing grade as good.

**§23 — intelligence rots.** `siu_review_note()` records revalidated,
downgraded, superseded or withdrawn against a named agent at a time. Withdrawal
resolves a note and never deletes it: what the unit believed, and when, is the
record.

**§25 — the watchlist always ends.** `expires_at` is mandatory, capped at a year
per grant, and read off the clock rather than a status column, so no sweeper
job has to run for expiry to bite. Field agents only — the same call as the
referral queue, because the list can name the Director. Removal keeps the row.

**§19 — deconfliction, and what it will not say.** `siu_deconflict()` returns
investigations the caller can already open, and for everything else a count plus
"coordinate through SIU command" — never the case, never the agent.
**Compartmented investigations are excluded from the count entirely**, which is
a real cost and is documented as one: a clean result does not prove nobody else
is looking. A hit count is an existence oracle, and a compartmented case exists
because its existence is restricted. The UI says "no other interest *recorded*"
and never "nobody else is interested".

**§30 — the one deliberate hole in the CID→SIU wall.** An investigation
sometimes needs an officer's expertise without appointing them to the unit. The
grant is cut as small as it goes: one case, standard classification only,
30 days maximum, revocable, audited — and spliced into `can_access_case()` and
`can_access_case_row()` but **never** into `siu_case_access()`, so the holder
gets the case file (reports, evidence, media, tasks) and not one row of
tradecraft. The classification test lives in the predicate, so reclassifying a
case upward closes every outstanding grant at once. The §17 recusal veto still
beats it.

*Found by the live probe:* the first cut patched only `can_access_case()` and
not its row-form twin, and the symptom was exactly what half a chokepoint
produces — the supporting officer could read the investigation's reports but not
the case row. The two are a pair and are now documented as one.

**§35/§36/§53 — two dashboards, two audiences.** `siu_command_dashboard()` names
people, because workload cannot be managed without names, but every count runs
under the caller's own visibility so a compartment contributes nothing to
anyone's total. `siu_oversight_supplement()` is counts only — no case, title,
name or label — and reports the numbers that make a unit legible: referral
volume and disposition, open inquiries, closures by reason, ungraded
intelligence, overdue reviews, live watches and live supporting grants.

`rls_test_cleanup()` gained a Delivery B branch. The temporary-access row is the
one that matters: a §30 grant is a live key into an investigation, and a fixture
holding one on a real case would keep reading that file every run — with its
password sitting in a GitHub secret. Removed and reported, without exception.
Each delete now carries its own counter, after the first cut shared one and
swept the grants silently.

Verified live in rolled-back transactions across five roles: 20 assertions on
grading, review, the watchlist, deconfliction (including the compartment
exclusion), the §30 containment boundary, expiry, reclassification, revocation
and both dashboards. Advisors: zero ERROR-level findings. Migrations
`20260831120000`, `20260831130000`, `20260831140000`; suite
`tests/rls/v169.test.ts`.

### SIU intake, case lifecycle and conflict of interest (§14, §15, §17, §32, §33)

The front of the SIU workflow: how work **enters** the unit, how it is graded
while SIU decides whether it is real, and how it is disposed of. Until now an
SIU investigation could only be opened directly, so every allegation became a
full investigation the moment anyone typed it in.

**§14 — the door is wide, the queue is narrow.** Any active member can submit a
referral; almost nobody can read one. `siu_referrals` is gated on
`private.siu_is_agent()` — SIU **field agents only**, deliberately not oversight
standing, because a referral can name the Director of CID. The submitter's own
view (`siu_my_referrals()`) strips every review column, so a referral confirms
receipt and never reveals whether SIU acted, declined, or opened an
investigation. Without that, filing a referral about yourself would tell you
whether you are a subject.

The CID-facing surface is a new **Report a Concern** page that never says "SIU".
That is the design, not decoration: a button naming the unit would disclose it to
every detective, and to the people it investigates.

**§15 — preliminary inquiries.** `cases.siu_stage` marks an investigation as an
inquiry, and an inquiry is invisible to oversight at *every* classification —
including the standard level the Director and the AG normally read. Field access
is unchanged. `siu_promote_inquiry()` is the deliberate, reasoned, one-way act
that opens it. This is what lets the unit examine a senior allegation before it
is sure, which is the usual reason to open an inquiry rather than a case.

**§17 — a conflict is a veto, and the first version wasn't.** `siu_declare_conflict()`
originally cleared the agent's assignment and read them out of any compartment.
A live probe showed the declaring agent still holding full read and write, and
still able to close the case. Two independent reasons:

1. `siu_case_access()` grants on **rank** — a Special Agent in Charge reaches
   every non-compartmented case with no assignment, so clearing an assignment
   cleared nothing. The conflicted officer the rule most needs to bind was the
   one it did not touch.
2. `siu_case_assigned()` is also satisfied by `cases.lead_detective_id`, which
   the new referral-acceptance path sets — so even a line agent who declared a
   conflict on a case they lead kept access.

Chasing each positive grant and subtracting from it is the wrong shape. A
recusal is a **negative fact**, so `private.siu_recused()` is now checked *first*
in `siu_case_access()`, above every grant including rank and `owner`, and
propagates for free to `siu_case_command()`, `siu_case_read()`,
`can_access_case()` and the ~115 policies routed through it. Same principle as
§37: a rule that exempts the top of the organisation is not a rule.

Declaring is gated on `siu_case_read()` rather than `siu_case_access()` — the
first probe found an oversight holder could not recuse themselves at all, which
is exactly backwards. Lifting requires `siu_resolve_conflict()`, which refuses
the agent who declared it; only `cleared` restores access, since `reassigned`
means the conflict was real and the work moved on.

**§32/§33 — category and closure.** `siu_category` is subject matter,
deliberately orthogonal to `siu_classification`, which is sensitivity —
conflating them is how a unit over-classifies everything whose subject sounds
serious. Closing requires a reason from a fixed list plus a note, and the list
includes `unfounded`, `insufficient_evidence` and `inactive`, because a list of
only successes pushes people to mislabel.

All four new `cases` columns are RPC-only, frozen by
`private.block_direct_siu_case_cols()`. `rls_test_cleanup()` gained an intake
branch (`20260830140000`) so fixture referrals cannot accumulate in the live
queue — a fixture referral naming a real officer is removed *and* reported as a
namespace escape.

Verified live in rolled-back transactions across five roles (CID detective,
Director/oversight, SIU field agent, SIU command, owner): 22 assertions covering
queue visibility, receipt shape, inquiry invisibility, promotion, the recusal
veto at command rank, self-resolve refusal, and closure validation. Migrations
`20260830120000`, `20260830130000`, `20260830140000`; suite `tests/rls/v168.test.ts`.

### SIU release gate OPENED — and a fixture privilege escalation closed first

The build-phase gate (`siu_settings.enabled_for_non_owner`) is now **open**. SIU
is live for appointed personnel and the SOP oversight chain.

**A pre-flight check caught a real problem, and it was mine.** The SOP
chain-of-command change gave every active `role = 'director'` profile SIU
oversight *ex officio*, and oversight is not passive — `siu_can_appoint()`
includes it, and `siu_remove()` lets oversight end an X-1's membership. That
silently armed `rls-test-director@cidportal.test`, a Command Center test
fixture whose password is the `RLS_TEST_PASSWORD_DIRECTOR` CI secret. Opening
the gate would have handed SIU appointment authority to anyone able to run the
test suite.

Migration `20260829120000` requires `not profiles.is_test` on both ex-officio
branches. Deliberate grants are untouched — an explicit `siu_memberships` row
still confers standing on a fixture (the post-release RLS lane needs it), and
`profiles.is_owner` still confers `owner`. The distinction is deliberateness:
somebody chose those; nobody chose to give the director fixture SIU authority.

The general rule, now documented: **a capability keyed on a CID role attaches to
every account holding that role, fixtures included.** Ex-officio grants need a
fixture exclusion; deliberate grants do not.

Standing after the gate opened, verified live:

| account | standing | department |
|---|---|---|
| Huxley Thatcher | `special_agent_in_charge` (X-1) | siu |
| Tom wood (owner) | `owner` (X-2) | siu |
| Oliver Ocho (Director of CID) | `oversight` | cid |
| Hunter jones (Attorney General) | `oversight` | — |
| **RLS Test Director** | **(none)** | cid |

Also recorded in `docs/TEST-ENVIRONMENT.md`: `rls-test-owner` carries
`profiles.is_owner` and can therefore call `siu_set_release()` itself. That is
pre-existing and load-bearing for the owner-path suites, so it is reported
rather than changed.

### Roadmap reconciliation + post-SIU advisor sweep

`docs/CID-FUTURE-STATE-SPEC.md` still described Phase 10 as "in progress on the
current branch (not yet merged)" — it merged as **PR #209**. The header also
claimed the roadmap ran "in full through Phase 9." Both corrected, and the same
stale line fixed in this file. The next audit would otherwise have read a
roadmap that was wrong about its own completion.

**SIU was absent from the roadmap entirely** — zero mentions, so a reader
working through it end-to-end would not learn that a second investigative
department exists. Added as a "Post-roadmap work" section with the full PR trail
(#235–#241) and a pointer to the authority model, explicitly marked as *not*
part of Phases 0–10.

**Phase 9's reliability sub-track is now the only open item in the roadmap**, and
its three parts have diverged rather than being uniformly "deferred":

- *Live-verifying CI secrets* — **unblocked** by PR #241. The one remaining
  action across the whole roadmap.
- *Staging/seed Supabase project* — deliberately not built; required only for
  the destructive seeded E2E suite and deterministic visual regression.
- *Playwright E2E + visual baselines* — still deferred, conditional on the above.

**Advisor sweep after the SIU build.** Security: **zero ERROR-level findings**.
The 176 `authenticated_security_definer_function_executable` WARNs are the
definer-RPC pattern the portal is built on, and the 3 `rls_enabled_no_policy`
INFOs are the intentional deny-all tables (`app_secrets`, `deletion_tokens`,
`security_test_runs`). Performance: one real item — `siu_settings_updated_by_fkey`
was the single FK across the whole SIU surface without a covering index, now
added. The 199 `unused_index` notices are expected while the release gate is
shut and the SIU tables hold no rows.

### RLS cleanup confined to the fixture namespace — F1–F5 closed

`rls_test_cleanup()` is `SECURITY DEFINER` and bypasses RLS; five of its
branches keyed on *authorship* rather than on test-created cases, so each could
reach a real CID record — including one that wrote to production `cases`/`gangs`
rows. Those were the blocker on enabling `RLS_TEST_PASSWORD_*`.

The branches existed to collect orphans, which looked like a trade: narrowing
them would leave test rows on production forever. A live scan settled it —
**zero rows on all eight escape surfaces**. They were collecting nothing, so
removing them costs nothing.

**The rule now:** a row is deleted only if it is fixture-owned *and* deleting it
cannot alter a record belonging to someone else.

- `reports`, `surveillance_*` and `intelligence_tips` live *inside* a case, so
  they are case-scoped. A fixture-authored report on a real case is reported,
  not deleted — it changes what that case contains and may be interleaved with
  real work.
- `operations` are top-level and fixture-created, so they stay cleanup's —
  except one linked to a non-fixture case, where the cascade would strip that
  case's joint access.
- `role_events` keeps `target_id = any(ids)` only. An event a fixture *acted on*
  for a real member is that member's assignment-provenance record.
- `cases`/`gangs.lead_detective_id` is nulled on test rows only. A disposable
  fixture leading a real case leaves it untouched and is simply not deleted — an
  inactive stray profile beats a mutated production case.

SIU rows go the other way on purpose: a fixture-authored `siu_case_note` or
`siu_disclosure` on a real case is invisible to CID, so leaving it would mean
live, division-visible test intelligence. Those are deleted *and* reported.

**Escapes are now loud.** Cleanup returns a `leaked` array naming anything a
fixture authored outside the namespace; `globalSetup` warns pre-run and throws
post-run, so a test that escapes turns the build red instead of being quietly
swept. The cost is deliberate: cleanup no longer tidies up after such a test, and
the row must be removed by hand.

Verified live in rolled-back transactions: a fixture-authored report on a real
case and a `role_events` row where a fixture acted on a real member both
**survive** cleanup and are reported, the real case is untouched, and a fixture's
own case + report + target + operation are all still swept with `leaked: []`.

**`RLS_TEST_PASSWORD_*` can now be enabled.**

### Test isolation policy, and a safety review of the RLS suites

No test database was created, and none was needed. Shipping SIU to production
never obliged anyone to build or rebuild one — a claim that had been repeated in
the SIU deployment notes and is now removed. `sahp-rbac`, the superseded legacy
project that predates `cid`, is explicitly **not** the test project and is left
alone.

The three test tiers are now documented as the distinct things they are, because
conflating them is how a test run becomes a production incident:

- **RLS/security integration** may run against production *conditionally* — every
  write namespaced to `rls-test-*` fixtures, cleanup through one audited RPC.
- **Seeded E2E** never may: `scripts/test-seed.sql` runs `truncate table … cascade`.
- **Visual regression** needs deterministic data, so it needs the same isolated
  database — but only once someone intends to run it in CI.

**`supabase/schema-snapshot.sql` is no longer documented as a rebuild method.**
It could never have worked: it carries none of the ten `private.siu_*` predicate
bodies or any `public.siu_*` RPC, only the policies that call them, so a snapshot
rebuild fails at the first SIU policy. Migrations are the source of truth, and
`docs/TEST-ENVIRONMENT.md` now gives the replay loop.

**Safety review before enabling `RLS_TEST_PASSWORD_*`.** No `TRUNCATE` or `DROP`
in `tests/rls/`, zero unfiltered `.delete()` calls, a correct caller gate on
`rls_test_cleanup()` with no NULL-guard hole, and a hard block on the production
ref in the seed script. But five branches of `rls_test_cleanup()` key on
*authorship* rather than on test-created cases and can therefore reach a real CID
record — including one that writes to production `cases`/`gangs` rows. They are
catalogued as F1–F5 in `docs/TEST-ENVIRONMENT.md`; the secrets should not be
enabled until they are tightened.

### Fix — rls_test_cleanup did not sweep ten SIU tables

Found by that review. The cleanup RPC covered the three SIU Phase 1 tables while
ten more had shipped since. All cascade from `cases`, so a row on a
fixture-created case was already removed; the gap was a row attached to a case
the fixture did **not** create — which §12 and §15 make possible by design, since
`siu_case_notes` keys to any case and `siu_disclosures.target_case_id` points at
a CID case. A future test releasing intelligence against a real case would have
left live, division-visible rows behind. Every new branch keys on fixture
authorship, never on a case id alone, so the blast radius stays inside the
fixture namespace by construction.

### SIU §14 — Assume SIU Control of a CID case

SIU can take over a live CID investigation. The requirement was preservation,
and the implementation is one column flip: `cases.case_authority` `cid` → `siu`.
`private.can_access_case()` already branches on case authority, so the case and
every child row leave CID's lists, counts, search, graph, realtime and
autocomplete at every rank the instant it lands — and because no child table is
touched, `reports.author_id`, `evidence.collected_by`, the custody chain and the
sign-off history survive byte-for-byte. The detective's work stays their work.

- Case number, bureau, originating bureau and lead detective are **not**
  rewritten, which is also what makes the takeover reversible.
- Four new provenance columns (`siu_assumed_at/_by`, `siu_assumption_reason`,
  `siu_returned_at`) are frozen against every direct write; the full
  before-picture goes to the audit log as `SIU_CASE_ASSUMED`.
- **No notification is emitted.** A takeover is frequently a takeover *from* the
  subject; the case simply stops appearing.
- `siu_release_control()` hands it back, and refuses unless the case was
  actually taken from CID — a natively-SIU investigation was never CID's.

Verified live: the detective loses the case, its report and its search hit at
once; the case number, bureau, lead and report author are unchanged; returning
control gives everything back.

### SIU §15 — Releasing intelligence to CID

Four routes — the whole Division, one case's members, one named investigator,
and "Release Intelligence" — all auditable and revocable.

**The snapshot is the mechanism.** A release carries a *copy* of the title and
body taken at release time, never a pointer into an SIU record. So releasing one
item cannot widen into the investigation (there is no edge to traverse), the
released text is immutable (what CID acted on is exactly what was released), and
revocation is real rather than a permission claw-back.

**The origin is never disclosed.** `siu_disclosures` is SIU-side only — CID
reads zero rows from it at every rank — and CID goes through
`siu_released_intelligence()`, which projects no `siu_case_id`, no source item
and no case number. Release requires field standing, so oversight cannot decide
what SIU tells CID; acknowledgement re-checks the audience rule so it can never
be used as an existence oracle.

### SIU Phase 3 — tradecraft

Six new domains: confidential sources, undercover deployments, financial
intelligence, communications intelligence, integrity reviews and a restricted
export log, plus an aggregate oversight report.

- **All six ride the WRITE wall, not the read superset.** The SOP chain change
  let oversight read a standard investigation's case file; oversight must not
  extend to raw tradecraft, because the Director of CID may be the *subject* of
  a source report, a legend, an intercept or an allegation.
- **Sources and legends narrow further** to the handler and SIU command
  (`private.siu_handler_access`), so an agent with full access to an
  investigation still cannot read another agent's source — and a leak inside SIU
  costs one source rather than the register. The deployed officer can always
  read their own deployment.
- Two constraints carry policy: communications **content** cannot be recorded
  without a named legal authority, and an integrity review cannot close without
  a recorded disposition.
- **Exports redact unconditionally.** `siu_export_case()` is the only export
  path, logs every call with a mandatory reason, and never emits source
  identities, undercover legends or intercept content — at any scope, for any
  caller, including SIU command and the Owner. It reports what it withheld, with
  counts computed under the caller's own visibility so the count is never an
  oracle.
- `siu_oversight_report()` gives the SOP chain counts only: caseload,
  takeovers, releases, integrity disposition, tradecraft volume. No case, name,
  codename, legend or identifier can reach it.

Verified live by role simulation: a peer agent with full case access reads zero
sources; the Director reads the standard investigation and none of the six
tables; a plain detective reads nothing at all; and every export scope withheld
the codename, the legend and the intercept content while keeping toll metadata.

### SIU chain of command — the unit's SOP is authoritative

The architecture amendment put SIU under the Attorney General with CID command
holding no SIU authority; the unit's own SOP puts it under the **Director of
CID**. The SOP wins. Migration `20260823120000_siu_sop_chain_of_command`
enforces `Commissioner's Office → Director of CID → X-Ray 1 → Special Agents`
(the Commissioner's Office maps to the Portal Owner, which has no separate
identity).

- **The Director resolves to `oversight`** — one new branch in
  `private.siu_standing()`, the same standing the Attorney General held. An
  appointed SIU role still wins, so a Director who is also X-1 is X-1.
- **Oversight is a READ standing, and that split is the whole design.**
  `private.siu_case_access()` — the wall feeding `can_access_case()` and every
  `siu_case_command()` check — is unchanged. A new `private.siu_case_read()`
  (the wall OR "standard `siu` classification seen by oversight") is spliced
  into read surfaces only: `can_read_case`/`_row`, `siu_case_agents_sel`,
  `siu_targets_sel`, `siu_can_read_case_note`, `siu_audit_feed`,
  `siu_overview` counts, `operations_sel`. Oversight cannot open an
  investigation, assign an agent, reclassify a case, author intelligence,
  designate a target, run an operation, or delete a row.
- **The escape hatch survives.** `siu_restricted`, `siu_command` and
  `siu_compartmented` still require assignment, SIU command or an allow-list
  row, so an investigation *into* the Director, the AG or X-1 remains possible.
  On a CID case the SIU-only intelligence layer stays field-agent only — the
  Director is a plausible subject of an integrity flag.
- **Consequence to plan around:** a standard `siu` investigation is now
  readable by the Director and the Attorney General. Anything concerning either
  of them must be opened at `siu_restricted` or higher.

Verified live by role simulation (release gate flipped inside a rolled-back
transaction): the Director reads the standard investigation, gets nothing at
restricted or compartmented, holds appointment authority, and is refused by
`siu_create_case` and `siu_assign_agent`.

### Fix — CID command could blind-delete SIU records

Found while verifying the change above, not by the build. `DELETE` never
required a read: seven case-child delete policies gated on
`private.can_delete()`, a pure CID **role** check with no case predicate, so an
active Bureau Lead, Deputy Director or Director could destroy reports, media,
tasks, blockers, assignments and `case_files` rows belonging to **any** SIU
investigation — compartmented included — given a row id. The record was hidden;
it was not protected.

`20260823130000_siu_case_delete_wall` adds
`private.can_delete_case_child()` / `can_delete_case_file()`: a CID-authority
case is `private.can_delete()` verbatim (no CID user gains or loses a single
delete), an SIU-authority case is `private.siu_case_command()`. SIU also gains
the delete it should always have had — X-1 and a lead agent can clean up their
own investigation without needing a senior CID rank. Live-verified before and
after: 1 row deleted before the fix, 0 after, with CID deletion unchanged.

### SIU Phase 2 — targets, operations, and the SIU-only layer on CID cases

Migration `20260822120000_siu_phase2` adds the three investigative objects the
SIU workspace was missing, in each case **extending** an existing system rather
than cloning it.

- **The SIU-only layer on a CID case.** `siu_case_notes` attaches restricted
  SIU intelligence — integrity concerns, corruption flags, compromised-officer
  and leak concerns, links back to an SIU investigation — to **any** case,
  including a CID one. There is deliberately no branch admitting a CID role:
  not the case's own lead detective, not CID command, not the Director. That is
  what makes investigating a compromised investigator possible without alerting
  them. Verified live: SIU raises a flag on a CID case, the SIU dashboard counts
  it, and the subject detective sees zero rows and `{access: false}`.
- **SIU targets.** Investigative designations (person of interest → subject →
  target → priority target → fugitive → … → cleared) pinned to an SIU
  investigation and pointing at the **shared** registries by
  `(entity_type, entity_id)` — one master record per person/vehicle/gang, with
  an SIU-only designation layered on top. A designation describes standing in an
  investigation; it is never a finding or a conviction.
- **SIU operations.** `operations` gains `authority` plus the §26 planning
  fields (category, objective, commander, legal authority, briefing,
  after-action, start time). CID operations are untouched and still visible to
  any active member; SIU operations are invisible to CID at every rank, and
  `authority` is RPC-only behind a guard trigger.
- **Surveillance needed no work** — `surveillance_targets`/`_observations` are
  already case-scoped through `private.can_access_case`, so an SIU investigation
  inherits the whole surveillance domain and its records are automatically
  invisible to CID.
- **Dashboard.** `siu_overview()` gains priority targets, active targets, active
  operations, unresolved intelligence, integrity flags raised on CID cases, and
  running surveillance; the workspace gains Targets, Operations and Intelligence
  sections reading them.
- Two predicates (`siu_is_agent`, `siu_is_command`) needed EXECUTE grants
  because they now appear inside RLS quals, which are evaluated as the querying
  role — the same requirement `siu_in_compartment` hit in Phase 1.
- Tests: `src/lib/siu.test.ts` → 38 cases; `tests/rls/v166.test.ts` gains the
  SIU-only-layer invisibility guard and the target/operation isolation guards.

### SIU becomes a separate department

Migration `20260821120000_siu_department` amends Phase 1: SIU is no longer a
separate *authority* inside the CID shell but a separate **department** on the
same platform — one portal, two investigative departments.

- **Active department.** `private.user_department()` resolves `cid` | `siu`
  from SIU membership (one identity, no duplicate accounts, no column that can
  drift from the roster). Gate-aware: while the release gate is closed everyone
  resolves to `cid`, so this migration is a **no-op for every existing account**
  and CID keeps working untouched during the build phase.
- **SIU is not CID.** An SIU department member loses the native CID case branch
  — bureau, lead/creator, command, joint access — and with it all CID case
  *write* access, keeping only the authority-based read-only oversight.
- **SIU's own ladder.** `special_agent` → `senior_special_agent` →
  `special_agent_in_charge` (X-1). X-1 is the Director-equivalent *inside SIU
  only*; the CID Director role is never reused or granted, and CID command is
  nowhere in the SIU chain (which runs Attorney General → X-1 → Agents).
- **Its own SOP.** A `siu` document classification — visible to SIU standing
  only, editable by SIU command, never CID command — plus the unit's SOP seeded
  as its own document. The CID SOP is never shown as the SIU SOP.
- **Its own workspace.** `siu_department_context()` is the single authoritative
  answer for which departmental shell to render; the sidebar, wordmark, banner,
  navigation and officer card all follow the department. A deliberate context
  switch exists only for accounts holding both (Owner, AG oversight) — never a
  "Switch to SIU" button for normal members. A case names itself by its
  **owning** department ("SIU Investigation" vs "CID Case"), and an SIU agent
  opening a CID case is told plainly they are reading it under SIU authority
  and are not a case member.
- Tests: `src/lib/siu.test.ts` grows to 34 cases (department resolution, the
  switch matrix, owning-department vocabulary, the senior tier);
  `tests/rls/v166.test.ts` gains the department + SIU-SOP separation guards.

### Special Investigation Unit (SIU) — Phase 1

Migration `20260820120000_siu_phase1` adds SIU to the portal as a **separate
investigative authority** that reuses every existing CID system rather than
duplicating it.

- **Authority model, not a rank.** A member operates as CID
  (`profiles.role` + `profiles.division`) *or* as SIU
  (`siu_memberships.siu_role` — `special_agent` / `special_agent_in_charge`,
  displayed as X-Ray 1, with free-form callsigns). No SIU rule reads a CID
  role, which is what makes investigating CID command structurally possible.
  Former CID rank is preserved and shown as history, never as authority. One
  resolver — `private.siu_standing()`, mirrored by `siuStanding()` in
  `src/lib/siu.ts` and surfaced as `useSiu()` — answers every SIU question, so
  no component re-derives permissions inline.
- **Asymmetric visibility.** `private.can_access_case` / `can_access_case_row`
  — the wall every case child already routes through — gain ONE branch: an
  SIU-authority case is governed by `private.siu_case_access()`, and the CID
  branch is byte-identical to `20260810120000`. CID gets **nothing** on an SIU
  case at any rank, in any surface (lists, search, autocomplete, entity
  profiles, graphs, media, timelines, legal, realtime) — no rows, no counts,
  no "restricted" placeholder. SIU's broad read of CID is a *separate,
  read-only superset* (`can_read_case` / `_row` / `_number`) used only in
  SELECT policies, so oversight can read a detective's report and can never
  rewrite one or destroy CID evidence.
- **Classification + compartments.** `cases.case_authority` (`cid`/`siu`) and
  `cases.siu_classification` (`siu` / `siu_restricted` / `siu_command` /
  `siu_compartmented`) are RPC-only (guard trigger
  `block_direct_siu_case_cols`), with their own `SIU-8000001` number series.
  **`siu_compartmented` is allow-list only, with no exemption for X-1, the
  Attorney General or the owner flag** — the list is managed from inside the
  compartment, cannot be emptied, and nobody re-admits themselves.
- **Appointment-only membership.** No request table, no queue, no signup
  option, no promotion path. `siu_appoint` / `siu_remove` are gated to the
  Portal Owner, X-Ray 1 and the Attorney General (an X-1 appointment is
  Owner-only; only the Owner or AG may end one; nobody removes themselves).
  Removal revokes access immediately while preserving reports, evidence,
  authorship, assignment history and audit. The AG holds SIU **oversight**
  (appointment + legal oversight) without becoming a field investigator.
- **Existing systems reused.** An SIU investigation *is* a `cases` row, so
  reports, evidence, media, tasks, chat, timeline, graph, intel links and the
  DOJ legal pipeline all work unchanged — `can_review_as_cid` /
  `can_approve_legal` gain one branch each so SIU command is the CID gate on
  its own investigation. No second court, no duplicate registries.
- **Audit.** SIU actions land in the Owner-only `audit_log` under entity
  `siu`; `siu_audit_feed()` serves compartment-respecting reads, so a subject
  under investigation never learns of the trail through an audit surface.
- **Build-phase release gate.** Until SIU is marked production-ready, only the
  Portal Owner can see, query or act on any of it — centralized in
  `siu_settings.enabled_for_non_owner` and one audited Owner-only RPC
  (`siu_set_release`), not scattered through components. For every other
  account SIU has no nav entry, no route, no rows, no notifications and no
  search hits. The production model above is already written and needs no
  rebuild when the flag flips.
- **NULL-safe authority predicates.** `siu_standing()` is nullable, and
  `NULL in (...)` is NULL rather than false — which made
  `if not <predicate> then raise` a no-op and skipped the plpgsql guard in
  every SIU write RPC (the justice NULL-guard class, `20260714070000`). Every
  standing predicate is now `coalesce()`-pinned to a strict boolean, with the
  same invariant asserted on the client mirror. Read paths were never
  affected: `siu_operates()` is `is not null` and `siu_case_access()` branches
  on an explicit null check.
- Tests: `src/lib/siu.test.ts` (27 capability-mirror cases) and
  `tests/rls/v166.test.ts` (live wall + a post-release production lane).
  Docs: [AUTHORIZATION.md §4f](docs/AUTHORIZATION.md), handbook ch. 9,
  REVIEW-MAP, TESTING.

### Bureau prosecutor queues, review routing, stages, and evidence designation

Migration `20260818120000_bureau_queues_stages` refines the minimal-DOJ
workflow and the case workspace:

- **Bureau-scoped prosecutor queues.** Every prosecutor holds exactly one
  home bureau (`justice_memberships.prosecutor_bureau`, required at
  appointment and on staged transfers) and sees/claims only their own
  bureau's shared queue. The Attorney General oversees all three queues and
  grants **temporary cross-bureau coverage** (`prosecutor_coverage` —
  explicit, dated, expiring, audited, endable, never permanent) via
  `justice_set_coverage` / `justice_end_coverage`; AG status alone never
  authorizes prosecutorial work. Claiming, AG assignment, prosecutor lane
  visibility, and the approve fan-out all ride one predicate
  (`private.prosecutor_bureaus_of` = home + live coverage); a queue with no
  covering prosecutor alerts the AG + Owner.
- **CID review routing.** An ordinary bureau case is gated by the
  responsible bureau's Bureau Lead only; a **JTF-assigned case by ANY
  eligible Bureau Lead**; Deputy Director / Director / Owner remain the
  fallback everywhere — and every decision by anyone other than the
  responsible bureau's own lead is audited with `fallback` /
  `jtf_any_lead` flags.
- **Judge-returned requests.** Corrections go to the investigator and
  resubmit **straight back to the bureau's prosecutor queue**
  (`resubmitted_to_prosecutor`); renewed Bureau Lead review happens ONLY on
  an explicitly **declared** material change (3-arg
  `submit_legal_request_to_cid`; the declaration is logged, never inferred).
- **Limited DOJ case access.** `legal_request_case_brief()` gives
  prosecutors/judges a database-enforced brief: concise case summary plus
  ONLY the request's referenced exhibits, finalized-report content, and
  media metadata — never case access.
- **Investigative stages.** `cases.investigative_stage` (intake →
  active_investigation → legal_process → enforcement_ready →
  pending_closure → closed) is a stored, manually-moved dimension distinct
  from case status: RPC-only (`case_set_stage`, required reason, case lead /
  Senior Detective+ / Owner), trigger-frozen against direct writes, audited
  with previous/new stage + actor + reason.
- **Evidence vs. general media.** `media_designate_evidence()` promotes a
  case upload to a designated evidence record (auto or custom reference,
  designating actor + timestamp) or clears it — the original uploader and
  timestamps are never touched.
- **Direct DOJ assignment handover.** `justice_appoint` (now 4-arg, bureau
  required for prosecutors) reassigns an appointed member's open led cases
  to the acting authority as **interim lead** (audited per case, command
  notified) — work is never stranded, with no approval wait reintroduced.
- **Manual review.** `justice_migration_review()` also surfaces prosecutors
  without a home bureau and JTF cases missing a responsible bureau.
- **UI.** Bureau-labeled DOJ queues with AG all-queue oversight + coverage
  management; a material-change declaration on resubmission; a case-brief
  panel for justice reviewers; an investigative-stage control with audited
  history; the Media tab split into Evidence / General uploads with
  promotion; a dedicated destructive case-deletion screen (exact case-number
  confirmation + dependency summary + reason); and the Action Center as the
  portal's default landing page.
- **Stage history in the Record tab.** `case_stage_history(p_case)`
  (migration `20260819120000_case_stage_history`) exposes a case's
  `CASE_STAGE_CHANGED` audit rows — when, who, from → to, reason — to
  members with case access (the audit log itself stays Owner-only), rendered
  as a timeline card in the case Record area that refreshes when the stage
  moves.

### Minimal DOJ, member transfers, and the investigative-workspace redesign

The legal pipeline regains a prosecutorial + judicial stage in minimal form
(migrations `20260816120000_minimal_doj_revival` +
`20260816130000_doj_transfers`). Bureau Lead+ approval is now the CID gate:
approve hands the request to ONE shared prosecutor queue (atomic claim,
Attorney General assignment; sealed requests are AG-assign-only), a
prosecutor approves it for judicial review (or returns it with corrections,
or declines it with a recorded reason), a judge decides with recorded
reasoning and optional conditions, and issuance stays a CID act — a
prosecutor or judge can never issue. Active justice roles are exactly
`attorney_general` / `prosecutor` / `judge`; legacy ADA/DA membership rows
are preserved untouched and mapped to the effective role `prosecutor`.
Conflicts recuse on permanent user IDs (request creator, case creator/lead,
any historical assignment, report author, evidence uploader, CID reviewers) —
not overridable by the AG; deactivating a member auto-returns their held work
to the queues, so no request can be stranded. Post-issuance corrections go
through supersession (`legal_mark_superseded`) — issued snapshots stay
immutable.

CID↔DOJ member transfers (`member_transfers`) preserve identity and
attribution end-to-end: DD+ authorizes, the AG (Owner for AG appointments)
accepts, a handover checklist blocks activation while the member still leads
open cases, and ONE transactional RPC ends the outgoing membership (dated
`role_events` row — never a deletion), reassigns work, and activates the
destination membership. Reverse transfers re-enter CID at an explicitly
approved new rank/bureau; temporary dual membership requires an expiry ≤90
days, lapses automatically, and forces an acting-capacity choice recorded on
every sensitive action. `membership_history` view composes the record.

The portal itself moves toward a dense investigative workspace: the case
page regroups its 14 tabs into an 8-area jacket (Brief / Investigation /
Subjects & Links / Evidence / Reports / Legal / Operations / Record) under a
flat persistent case header (assigned unit vs responsible bureau vs lead,
stage, blockers, overdue work, primary next action); the cases registry
defaults to a dense sortable table (grid/board still available); My Desk and
Central Command trade metric tiles for compact bordered strips; the Action
Center gains prosecutor/judge/AG/transfer awareness; and `/legal` is
role-aware — CID members keep their surface while justice members get the
minimal DOJ workspace (queue, my requests, judicial queue, returned,
archive, AG administration) with recusal notices surfacing server refusals
verbatim. No tab, action, or deep link was removed.

### JTF legal routing

Legal requests on JTF cases no longer dead-end at draft creation. Root
cause: `cases.bureau = 'JTF'` is an *operational* assignment, but the
legal-routing resolver only consulted `bureau`/`originating_bureau`, so a
JTF case with a null (or `'JTF'`-poisoned) responsible bureau failed with
no fix path in the UI. Legal routing now rides the case's **responsible
bureau** (`cases.originating_bureau`, always LSB/BCB/SAB or null): the
server chain `private.legal_resolve_bureau` resolves bureau (permanent) →
originating bureau → case-number prefix → lead detective's division →
creator's division, persists (and audits) successful derivations onto the
case, and existing JTF/poisoned rows were **backfilled** through the same
chain (unresolvable rows normalized to null and flagged, never guessed).
Routed approval is **narrowed**: a bureau lead now approves only requests
routed to their own bureau; Deputy Director+ keep cross-bureau authority.
New UI surfaces: the legal create wizard previews a derived routing (with
its source) and lets a Senior Detective+ set a missing responsible bureau
inline; the case command header shows a `Routing: <bureau>` badge (or an
amber `Needs routing bureau`); case Overview lists "Assigned unit: JTF
(operational)" vs the responsible bureau; and a Set/Change responsible
bureau action joins the case action menu (change is Deputy Director+/Owner
with a recorded reason) — all through `resolve_case_originating_bureau`;
the bureau columns stay frozen against direct writes. Migration
`20260815120000_jtf_legal_routing`.

### Surveillance & Intelligence domain

The portal-side surveillance pipeline (SOP Title 7): **surveillance
targets** with a server-authoritative authorization lifecycle (draft →
pending_approval → authorized → active → suspended → completed, plus
denied/expired/cancelled; Bureau Lead+ decides, never their own request,
every decision in `surveillance_target_history` + audit), **structured
observations** (unverified by default, guard-stamped provenance, restricted
rows walled to command/logger/reviewer, per-viewer view-auditing via the
widened `log_restricted_view`), a **detective verification queue** in the
Action Center, **intelligence tips + patrol submissions** (one triage
queue; confidential source identity in a stricter-walled side table),
**association events**, **explainable pattern alerts** (configurable rules,
open-dedupe, every alert states its rule/threshold/window and that a
pattern is a lead, not proof), **cross-case deconfliction** with
existence-only stubs for hidden cases, verified-only **registry observation
history** (person/vehicle/place/gang), a **surveillance report template**
in the existing engine, case timeline/graph integration, and the dormant
**inbound FiveM bridge surface** (`bridge_ingest_event`, service_role-only,
idempotent, quarantining) plus the **MDT sync acknowledgement path**
(`mdt_bridge_ack`, service_role-only) the bridge contract previously
documented as missing. Migration `20260812120000_surveillance_domain`
(additive; validated on a scratch cluster with a 14-scenario functional
smoke). Discord and the FiveM sensor side are untouched.

### Joint / JTF Operations — operation-scoped joint cases

Operations now come in two kinds: **normal** (bureau-owned coordination —
new operations are stamped with the creator's bureau; legacy rows keep
today's behavior) and **JTF** (multi-bureau joint task force with a lead
bureau and participating bureaus). A case linked to an *active* JTF
operation becomes a joint case **within that operation's scope**: active
members of the participating bureaus gain access to exactly the linked
cases (and their child rows, search hits, realtime payloads) through one
new branch in `private.can_access_case` — never bureau-wide, and never
overriding stricter walls (sealed/classified legal, restricted media, CI
materials). Ownership never moves: linked cases keep their bureau, case
number, and lead detective; the lead bureau only coordinates.

Migration `20260810120000_jtf_operations`: `operations` type/lead/lifecycle
columns, `operation_bureaus` (participation registry with joined/left
history), `operation_case_links` (permanent participation history —
`was_jtf` is the historical joint marker, kept through case closure,
operation resolution, manual removal, and revert-to-normal), a validating
link-sync trigger on `cases.operation_id` (participating-bureau +
`can_manage_joint` authority, full audit + lead notifications), a column
freeze guard on operations, and audited command RPCs
(`operation_convert_to_jtf` / `add_bureau` / `remove_bureau` / `set_lead` /
`revert_to_normal` — remove/revert refuse while linked cases would be
stranded). Ops page becomes a JTF workspace (participants, per-bureau Add
Case picker, personnel, derived timeline, former participations); case
header/board show operation-derived JOINT badges with the "why" and
"Joint via Operation …" chip; the case timeline gains joined/removed/
resolved events. Pure client mirrors + pins in `src/lib/opsJoint.ts`;
live security matrix in `tests/rls/v138.test.ts`.

### CID SOP refreshed to the current OdysseyRP document

The SOPs & Library "Criminal Investigation Division (CID) Standard Operating
Procedure" now carries the current OdysseyRP CID SOP verbatim (authoritative
Google Drive document, source last modified 2026-08-03) — three-bureau
jurisdiction model (LSPD / BCSO / SAHP + joint task forces), Title 2 chain of
command, and the Title 12C compensation brackets. Content replacement only:
migration `20260809120000_cid_sop_odysseyrp_refresh` updates the existing
`documents` row in place through the `document_save` version model (prior text
stays in version history; acknowledgements/bookmarks survive), moves it under
the command-locked `SOPs` folder, and classifies it `sops`/`sop`. The safe
mini-Markdown renderer additionally renders `[text](https://…)` links as
http(s)-only anchors, and `src/lib/sopContent.test.tsx` pins the rendered
structure (all 12 Titles, section order, the compensation table, anchor ids).

The **Records & Requests** domain and the 10-phase roadmap built on top of it.
This is the current, authoritative shape of the legal/records surfaces — it
**supersedes** the DOJ / Justice Portal redesign below: the active
DOJ / AG / ADA / Judge / prosecutor legal-review workflow was **RETIRED** in
Phase 1 and folded into a Bureau Lead+ review model. Historical judicial
records (justice memberships, signatures, decisions, court packets) are
**preserved** untouched.

> **Two unrelated "Phase" numbering schemes.** The phases below (Phase 1 …
> Phase 10) are the *records/requests roadmap*. The `## Phase 1` … `## Phase 11`
> build-wave headings much further down this file are the *original
> 2026-06 build waves* and have nothing to do with this roadmap — see the
> disambiguation note above the first of them.

### Records & Requests foundation (D1–D7) — PR #193

The discovery-driven records/requests delta that seeds the roadmap: legal
hold (D7), warrant execution + seized-items inventory (D3), Lead+-gated MDT
exports (D4), the Accounts registry + cross-registry search (D1/D2), and
restricted-content view-audit + break-glass (D6).

- Migrations `20260807190000_legal_hold`, `20260807200000_legal_execution_inventory`,
  `20260807210000_mdt_exports`, `20260807220000_accounts_registry`,
  `20260807230000_search_include_accounts`, `20260807240000_restricted_access`.

### The 10-phase roadmap

Each phase → PR number(s) → backing migration(s). Phases 7 and 8 are UI-only
(no migration).

- **Phase 1 — DOJ/Judge/ADA retirement → Bureau Lead+ approval** (PR #197):
  `20260808140000_legal_lead_approval`. Legal-request approval moves to
  `private.is_command()`; no ADA/DA/AG/Judge step remains. Historical judicial
  paper is preserved.
- **Phase 2 — legal-hold preservation lock** (PR #198):
  `20260808160000_legal_hold_preservation`. An active hold now blocks
  archive/delete/merge at every destructive chokepoint (`private.case_has_active_hold`).
- **Phase 3 — custody-grade warrant execution + seized items** (PR #199):
  `20260808180000_warrant_execution_completion`,
  `20260808200000_seized_item_case_scope`.
- **Phase 4a — accounts expansion** (PR #200):
  `20260808220000_accounts_expansion`, `20260808240000_accounts_merge_hardening`
  (taxonomy, polymorphic links, merge).
- **Phase 4b — returned-record extraction** (PR #201):
  `20260808260000_returned_record_extraction`.
- **Phase 5 — MDT & FiveM bridge expansion, dormant** (PR #203):
  `20260808280000_mdt_bridge_expansion` (ships in code, inert on the site).
- **Media follows case access — bureau-scoped media** (PR #204):
  `20260808300000_media_bureau_scope` (interleaved between Phase 5 and 6).
- **Phase 6 — Lead-granted break-glass + D5 in-app reminders** (PR #205):
  `20260808320000_break_glass_lead_granted`, `20260808340000_break_glass_hardening`.
- **Phase 7 — case-workspace polish** (PR #206): UI only.
- **Phase 8 — design-system consistency + mobile pass** (PR #207): UI only.
- **Phase 9 — advisor hardening** (PR #208):
  `20260808360000_advisor_hardening` (anon-EXECUTE drift, search_path pin, one
  policy fix, FK indexes).
- **Phase 10 — historical cleanup & documentation** (PR #209):
  `20260808380000_historical_cleanup` (~5 non-judicial rows via idempotent
  predicates; this reconciliation of `CHANGELOG.md`, `supabase/README.md`, and
  `supabase/MIGRATION-HISTORY.md`).

## [Unreleased] — DOJ / Justice Portal operational redesign — SUPERSEDED

> **SUPERSEDED** by the Records & Requests roadmap above. The active
> DOJ/AG/ADA/Judge/prosecutor workflow this redesign polished was RETIRED in
> Phase 1 (PR #197) and folded into Bureau Lead+ legal review. Kept here as
> history; historical judicial records remain preserved.

Interface/workflow-clarity redesign of every legal surface (PR #178); no
authority rule was weakened. Durable design notes:
[`docs/DOJ-INTEGRATION.md`](docs/DOJ-INTEGRATION.md) § Operational redesign;
full verification record:
[`docs/archive/DOJ-REDESIGN-REPORT.md`](docs/archive/DOJ-REDESIGN-REPORT.md).

- One deterministic workflow model (`src/lib/legalWorkflow.ts`) now drives
  every legal surface: the rebuilt `/legal` investigator landing + guided
  create wizard (structured search-warrant targets, bounded record pickers),
  the unified `LegalRequestDetail` dossier shared by CID and every Justice
  seat (deep-linkable sections, role decision panel, court-packet print),
  the Justice Portal sub-views (overview, requests, judge docket with the
  parallel claim lane, issued/service boards, roster & coverage), and the
  Action Center legal branch (awareness-only rows never count as action).
- Migration `20260806010000_legal_structured_targets` — additive: exhibit
  kinds vehicle/place/prior-request, per-target rationale, resubmission
  change summaries; three RPCs extended with defaulted params.
- Migration `20260806040000_legal_cid_reviewer_visibility` — fixes a
  pre-existing stall (the notified CID supervisor could not see a
  classified/restricted submission): visibility follows review authority
  only during `cid_supervisor_review`; sealed audiences unchanged. New live
  RLS suites v136/v137.

## [Unreleased] — Usability roadmap, Phase 2

### Added — Action Center
- A new **Action Center** tab (in the Command group, beside My Desk): one
  prioritized queue of everything awaiting a decision or action from the
  signed-in member — sign-offs to decide, cases returned to them, overdue and
  open tasks, transfer decisions, case-access requests, and (for command)
  pending membership approvals. Each row deep-links to where the action happens;
  the actual writes stay in the owning surface (the RPCs remain the authority).
  It's the actionable slice of My Desk (which links to it), sharing the same
  data sources.

### Added — case activity recap
- The case Overview shows a **"Since your last visit"** banner summarising what
  changed (evidence / reports / tasks added, legal updates) since the viewer
  last opened this case — a per-case marker re-stamped on leave. Purely
  informational; it never suppresses a notification.

### Added — case handover
- The current lead (or command) can **hand a case to another officer** from the
  case header: pick the new lead + an optional note. Both the outgoing and
  incoming lead are notified (a new case-access-gated `case_handover` type on
  the guarded `create_notification` path), so a lead change is never silent.
  Migration `20260721030000` adds the type to the whitelist.

### Added — smarter case creation from templates
- Case templates gain an optional **default follow-up interval**
  (`case_templates.followup_days`): applying a template to a new case sets
  `follow_up_at` to today + N days, so the Guided-next-action banner and the
  Division Calendar surface the review automatically (never overwrites a
  follow-up an editor set). The New-case template picker previews it, and the
  template manager edits it. Additive column; no policy change.

### Security — re-hardened `create_notification` (the client notification path)
- The live function had drifted to an un-guarded form: any active member could
  insert a notification of **any** type with arbitrary free text to any other
  member — i.e. spoof a "sign-off approved" / "legal decision" / "membership
  approved" notice. (An earlier guard existed but was superseded; its whitelist
  also predated rebuild type names like `stale_case`.)
- Verified no database function calls `create_notification` (every server-owned
  notice is inserted directly by its own definer RPC), so the client emits a
  fixed set of seven types. The function now **whitelists exactly those seven**
  and enforces per-type authority (`member_approved` ⇒ command;
  `access_requested` ⇒ a matching pending request; `stale_case` /
  `task_assigned` / `chat_mention` ⇒ case access; `tracker_*` ⇒ self/command),
  keeps the server-stamped actor, and clamps free-text fields. Migration
  `20260721010000`; 5 new live RLS tests (155/155).

## [Unreleased] — Usability roadmap, Phase 1

Theme: the portal tells members what changed, what matters, and what to do next.

### Added — shared case-state evaluator (the foundation)
- Pure, unit-tested rules engine `src/lib/caseWorkflow.ts` (`assessCase`): given
  a case + its tasks, reports, legal requests and evidence/support counts, it
  derives the workflow stage, an ordered list of actor-specific next actions,
  and the closure-blocker set. Single source of truth for Guided next action,
  the pre-close checklist and My Desk hints, so they can't drift. The
  sign-off/legal RPCs stay the authority for who may act. 20 unit tests.

### Added — Guided next action
- The case **Overview** leads with a "Next action" banner: stage badge + the
  highest-severity recommendation (with follow-ups), each deep-linking into the
  relevant case tab.

### Added — Case legal panel
- The case Overview shows the case's warrants/subpoenas (active + a collapsed
  resolved list) via the shared `LegalRequestRow`, deep-linking into `/legal`
  — the case ↔ legal connection that was missing.

### Added — Pre-close checklist
- Closing a case runs the evaluator and enumerates unresolved work (open
  sign-off / tasks / legal / drafts) in the confirm, with a "Close anyway"
  override.

### Changed — My Desk is the home
- My Desk (the personal inbox) is now the default landing page and leads the
  Command nav group; a command-only "Command administration" banner surfaces
  the live pending-approval count (excluding members moved to DOJ/Judiciary,
  consistent with the roster fix).

### Added — expanded global search
- `search_all` now also finds reports (by body values, never JSON keys),
  evidence, and operations; report/evidence hits open the owning case's tab.

### Added — better notifications
- Bell rows are no longer dead ends: a destination route map opens the case,
  legal request, Justice Portal, Command Center, announcement or owner surface
  as appropriate. Assigning a case task now notifies the assignee.

## [1.17.1] — 2026-07-14

### Fix — members moved to DOJ/Judiciary no longer resurface as pending CID sign-ins
- After an organization correction moves a member out of CID, their CID
  profile is deactivated but kept as history (`active=false`,
  `removed_at=null`). The command roster treated every such profile as a
  brand-new pending sign-in — showing them as "Detective · JTF · Pending"
  with a one-click **Approve** button that would have re-activated their CID
  membership *while they hold an active justice identity*, re-creating the
  exact dual-organization state the correction resolved.
- **Server guard:** `assign_member(set_active := true)` now refuses to
  reactivate a member who holds an active `justice_memberships` row, pointing
  the operator to organization correction (Move to CID) instead. This mirrors
  the block the correction RPC already enforces in the other direction. Live
  RLS suite: 150/150.
- **Roster display:** Command Center → Personnel & Admin lists these members
  in a distinct read-only **Moved to DOJ / Judiciary** section (showing their
  former CID role → current justice role) instead of the pending queue, and
  the Approval Queue no longer offers them for quick approval. Backed by a new
  command-only `justice_memberships` read (`useJusticeRoster`).

### Fix — clearer Manage Officer danger-zone wording
- "Deny login access" and "Permanently remove from CID" are now explicitly
  contrasted (a one-line "two different actions" note plus expanded confirm
  dialogs spelling out what each does and does not do), so denying access is
  no longer confused with erasing the account.

## [1.17.0] — 2026-07-14

### Security — RLS test fixtures hidden from every ordinary surface
- New authoritative marker **`profiles.is_test`** (seeded for all
  `rls-test-*` accounts, stamped at creation by `handle_new_user`, frozen
  against direct client writes, owner-settable via the audited
  `set_profile_test_flag`).
- **Real members no longer see fixture accounts anywhere**: the `profiles`
  SELECT policy is viewer-scoped (fixture viewers still see fixtures — the
  live security suites depend on it), `justice_directory`,
  `admin_member_emails`, `admin_membership_requests`, and
  `admin_justice_membership_requests` exclude fixture rows/requests for
  real callers, and announcement/notification fan-out (membership + justice
  submissions, transfers, client-error owner pings) never crosses the
  fixture/real boundary in either direction.
- `profiles_command` narrowed from FOR ALL to **UPDATE-only** (its SELECT
  arm would have bypassed the new visibility rule; its INSERT/DELETE arms
  had no client use).
- Motivation: fixtures were visible enough that production command staff
  manually denied/removed them (twice), breaking the suites. Deleting the
  accounts would destroy the 150-test live security suite; hiding removes
  them from the portal instead. Permanent-deletion machinery ships
  separately with its own safeguards.

### Added — organization correction (Owner-only)
- **`correct_membership_organization`** fixes accounts approved into the
  wrong organization: CID → DOJ (ADA/DA/AG) or CID → Judiciary (Judge)
  deactivates the CID membership (all history preserved) and files a
  pending justice membership request through the **normal approval
  matrix**; DOJ/Judiciary → CID deactivates the justice membership and
  files a pending CID membership request for Command review. Never converts
  `profiles.role` into a justice role; blocked while unresolved active
  assignments (lead cases, case assignments, open tasks/transfers, assigned
  legal requests, bureau coverage) need deliberate reassignment; reason
  required; initiator/approver/completion all recorded; the member is
  notified; test fixtures are rejected outright. UI: Manage Officer
  ("Move to DOJ / Judiciary…", Owner-only) and the Justice portal personnel
  board ("Move to CID…", Owner-only).

### Added — Owner-granted dual justice membership
- **`owner_grant_justice_membership`**: the Owner may appoint an existing
  active CID member as a department prosecutor (or DA/AG/Judge) without
  deactivating their CID identity — the Owner tops every justice approval
  matrix, so the audited direct grant is matrix-consistent. Ordinary signup
  still blocks active CID members from applying; dual identity is an Owner
  decision. Test fixtures can never be granted justice memberships.

### Tests
- New `tests/rls/v117.test.ts` (fixture-viewer visibility retained; owner
  un-flag/re-flag proves a real viewer gets zero fixture rows/counts and a
  fixture-free justice directory; flag is owner-only and write-frozen;
  correction and grant are Owner-only and fixture-refusing). Full live
  suite: **150/150** after deployment.

## [1.16.0] — 2026-07-13

### Added — unified role & department assignment system
- **One server-side authority matrix** (`private.can_assign_cid_role`,
  mirrored client-side in `src/lib/roles.ts`) now governs every CID role
  assignment — signup approval, promotion, demotion, and transfer role
  changes: Detective/Senior Detective ← Bureau Lead of that bureau or
  higher; Bureau Lead ← Deputy Director+; Deputy Director ← Director+;
  Director ← Owner. Owner is a flag, never a requestable or assignable
  role. No self-approval, self-role-change, or self-transfer anywhere.
- **Signup now offers every normal CID role** (Detective through Director;
  the `requested_role` CHECK was widened) with explicit wording that
  requesting grants nothing. The approved screen shows requested vs.
  approved role/department, the approver, and the effective date.
- **`change_member_role(p_target, p_new_role, p_reason)`** — dedicated,
  audited promotion/demotion RPC (same-department only; requires authority
  over BOTH the old and new role, so demoting a Director takes the Owner;
  reason required; writes `role_events` + `ROLE_CHANGED` audit + officer
  notification).
- **Officer transfers** — new `transfer_requests` workflow
  (`pending_source → pending_target → approved → completed`, plus
  rejected/cancelled; one open transfer per member): a Bureau Lead may
  initiate outbound or request inbound but never take a member from
  another bureau unilaterally; cross-bureau moves need source **and**
  destination approval; Deputy Director+ may complete directly (recorded
  as an override when approvals were missing). Completion applies
  `profiles.division` atomically with `role_events` (source `transfer`),
  `TRANSFER_*` audit rows, and notifications to the officer and both
  bureaus' leads (test fixtures excluded from fan-out). Transfer
  visibility is **bureau-scoped**: only the target officer, the requester,
  the source/destination Bureau Leads, and Deputy Director+/Owner can see
  a transfer — an unrelated bureau's Lead gets zero rows (and no counts,
  notifications, or realtime events, which enforce the same policy).
- **`role_events` provenance** — new `reason`, `source`
  (membership_approval / role_change / transfer / activation) and
  `source_id` columns make the latest event the member's authoritative
  assignment record (no duplicate provenance columns on `profiles`).
  Approve-with-changes, promotions, demotions, and transfers all require a
  recorded reason.

### Changed
- **`assign_member` narrowed to activation/deactivation only** (the old
  4-argument role/division/active signature is dropped). Manage Officer is
  restructured into separated actions — *Save profile details*
  (name/badge/LOA), *Change role*, *Transfer department*,
  *Deactivate/Activate*, and the danger zone — a changed dropdown never
  silently changes an assignment; each privileged action shows a summary
  and requires a reason.
- **Promotions & Transfers** (Command Center) now hosts the live transfer
  queue (approve source/destination, complete, reject, cancel — matrix
  gated) and the role/assignment history with reasons and sources.
- JTF remains a temporary joint-case designation: it is no longer offered
  as a division in Manage Officer, is rejected by every assignment RPC,
  and stays excluded from signup (explained inline).

### Security
- **Closed a privileged-write bypass:** the `profiles_command` RLS policy
  allowed any command member to `UPDATE profiles.role/division/active`
  directly via PostgREST, skipping `assign_member`'s bureau-lead scoping
  and `role_events`. A new non-definer trigger
  (`private.block_direct_privileged_profile`, same pattern as the
  login-denial guard) freezes `role`, `division`, `active`, `is_owner`,
  and `removed_at` on **every** direct client write — the definer RPCs are
  the only mutation path.
- `private.can_announce` no longer lists the retired `supervisor`/`command`
  roles (last disagreeing role list in the schema).
- Live RLS coverage: rewritten Command Center block (activation-only
  `assign_member`, direct-write freeze regression, lead scoping, two-lead
  transfer flow, self-transfer/JTF rejections, history) + new
  `tests/rls/v116.test.ts` (signup role range, Owner/JTF unrequestable,
  no self-review, matrix denials per rank, reason-required, Owner approves
  Director-final, assignment permanence, Judge has no CID authority) +
  `src/lib/roles.test.ts` pinning the client matrix to the server's.
- Test infra: `rls_test_reset_member` (callable only by rls-test accounts,
  only against rls-test profiles) replaces the suites' use of the old
  combined `assign_member`; `rls_test_cleanup` now purges
  `transfer_requests`.

## [1.15.0] — 2026-07-13

### Added — DOJ search warrants
- **`search_warrant` is now a first-class warrant subtype** in the DOJ
  legal-request workflow (v1.13 shipped with `arrest_warrant` only). It uses
  the **same single workflow** — CID → ADA → Judge — and can be **approved
  only by a Judge** (inherited unchanged: every warrant routes to `judge`, and
  no ADA/DA/AG path can approve a `judge`-routed request). It defaults to the
  `classified` classification like every warrant.
- Unlike an arrest warrant, a search warrant may target a **person and/or one
  or more places / properties / postal areas / vehicles** — it does **not**
  require a Persons-registry suspect, only a subject *or* at least one search
  target (`form_data.search_targets`). New warrant form fields (search targets,
  place/property to search, items sought, vehicle targets; probable cause is
  the existing narrative) render in the create form, the reviewer detail, the
  submit checklist, and the packet preview.
- **MDT projection is now restricted to arrest warrants.** A search warrant
  targets premises, not a fugitive, so it never creates an MDT "wanted person"
  projection even after approval and issue.

### Added — audited legal-request import (owner-only)
- New provenance columns on `legal_requests` (`source_system`,
  `source_submitted_at`, `source_submitter_id`, `imported_by`, `imported_at`,
  `import_key`) and an owner-only, **idempotent** `import_legal_warrant()` RPC
  for migrating historical in-city warrants into the DOJ workflow. It
  preserves the historical submitter and submission timestamp **separately
  from** the real import actor (never falsifying `auth.uid()`), lands each
  request at `submitted_to_doj` intake (never approved, signed, issued,
  executed, or MDT-projected), freezes an immutable submitted version, attaches
  reused canonical exhibits plus http(s)-only external links, and writes a
  `LEGAL_IMPORTED` audit row. A deliberate owner-only
  `import_rollback_by_key()` reverses an import without deleting audit history.
- **Owner-maintenance authorization** (`private.is_owner_maintenance()`): the
  import/rollback RPCs authorize on the `profiles.is_owner` super-grant
  **independent of CID `active`/roster status**, so an inactive owner never
  requires a temporary `active` toggle to run a one-time import.
  `private.is_owner()` is unchanged and still governs every ordinary owner
  surface. Verified in production: an `active=false` owner passes the import
  gate (previously it did not).

## [1.14.0] — 2026-07-13

### Changed — shared platform (DOJ patterns promoted portal-wide)
- The reusable pieces the v1.13 DOJ build proved are now **extracted shared
  components**, each shipping with two or more non-DOJ adopters
  (`docs/DOJ-INTEGRATION.md` adoption register updated):
  - `ui/WorkflowTimeline` — legal request History tab, case sign-off history,
    evidence custody chain (expandable), Command Center approval-queue
    history, and the CID + Justice membership-request applicant history
    panels.
  - `shared/RelatedRecordPicker` — legal exhibit pickers, investigative-report
    evidence lookup, RICO predicate-act evidence links.
  - `shared/VersionViewer` — finalized report versions (new, below) and the
    SOP history modal.
  - `shared/SignatureViewer` — legal version-bound signatures, report seal
    signatures (including superseded seals preserved in the reopen log), and
    tracker command co-signs.
  - `ui/DeadlineChip` + `lib/deadlines` (the shared deadline engine;
    `lib/justice.ts` `deadlineInfo` now delegates to it) — legal
    expiry/response deadlines, case-task due dates, joint-case access expiry,
    case follow-ups.

### Added — report versions (`report_versions`)
- `report_finalize()` now **snapshots every sealed version** (fields +
  signature at seal time) into a new `report_versions` table — seal v1,
  reopen, edit, seal again → v2 with v1 still readable. Versions are
  **immutable to clients** (UPDATE trigger-blocked, all write grants
  revoked — the definer RPC is the only writer); SELECT follows the report's
  case access. A **Versions** toggle on a sealed report shows exactly what
  each seal contained, rendered through the shared viewers.

### Added — legal requests in global search
- `search_all` gained a `'legal'` kind. The function stays **SECURITY
  INVOKER**, so every hit passes the `legal_requests` SELECT policy — sealed
  requests remain **undiscoverable by construction**. Only authorized header
  fields are matched and shown (request number, title, suspect/recipient
  snapshot, case number, statuses); narratives are never indexed. The search
  palette routes legal hits to `/legal?request=<id>`.

### Added — packet preview before submission
- Submitting a legal request for CID review now opens a **preview step**
  first: a requirements checklist, the included exhibits cross-checked
  against their live sources (broken-source and non-finalized flags), and an
  explainer that DOJ receives **only the packet**, never general case
  access. The existing submit RPC runs unchanged after confirmation.

### Added — draft recovery (never-lose-work)
- The legal create form stashes on-device under `legal:new:<kind>` and the
  edit form under `legal:edit:<id>`. Restore is offered via an **explicit
  banner only when the stash is newer than the server row**, and the stash
  clears on save/submit. (Reports and chat already had drafts.)

### Added — Owner Security Testing dashboard
- New Owner Portal section (`/owner?s=security`,
  `owner/SecurityTestingSection`): latest sanitized RLS-suite results, live
  fixture-account health, and leftover test-data counts. Backed by a new
  `security_test_runs` table with **zero client grants** — two audited
  definer RPCs are the only path in or out:
  - `security_test_report()` — callable **only by the
    `rls-test-%@cidportal.test` fixtures** (the suites report their own
    results), sanitizes failures server-side (short name/expected/actual
    strings only — never row contents), keeps the newest 50 runs per suite,
    audit-logged. Posted automatically by a new vitest reporter
    (`tests/rls/securityReporter.ts`, registered in `vitest.rls.config.ts`)
    after every `npm run test:rls` run, CI or local — strictly best-effort
    and self-skipping without env.
  - `owner_security_overview()` — `private.is_owner()`-gated and audited;
    returns sanitized run results + fixture health + leftover test-data
    counts.
  Hard guarantees: the browser never executes privileged RLS tests, never
  sees fixture passwords or a service key, gets no SQL console, and sees
  sanitized failure output only.

### Added — zod read-boundary validation
- New `src/lib/schemas.ts` (zod ^4.4.3): **tolerant** parsers for legal
  `form_data`, packet manifests, notification payloads, report signatures
  and reopen logs, and the security overview — malformed JSON degrades to a
  safe empty value instead of crashing a reviewer's screen. `jsonShapes`
  stays in place for its existing consumers. Validation never widens
  access — RLS remains the authority.

### Boundaries preserved
- No classification/RLS expansion beyond legal requests; no new warrant
  subtypes; no Sentry (the `client_errors` reporter is unchanged); every DOJ
  authorization, sealed-access, immutable-version, and signature guarantee
  from v1.13.0 is intact.

## [1.13.0] — 2026-07-13

### Added — DOJ Legal Review System
- A **limited legal-review workflow** for CID warrants and subpoenas, built as
  a **separate identity domain** from CID. DOJ roles (ADA, DA, AG) and the
  judicial role (Judge) live in a new `justice_memberships` table — **not** in
  the CID `app_role` enum and never in `ROLE_ORDER`, so a Judge never outranks
  a Director and an ADA never gains Command authority. `profiles.division` is
  never consulted for justice access. Full spec: `docs/DOJ-INTEGRATION.md`.
- **Adaptive first-login Gate:** applicants choose a domain (CID / DOJ /
  Judiciary); the role menu and fields adapt (CID bureau for CID only; a
  Badge/Bar/Court identifier for justice). Selecting a role grants nothing —
  activation happens only inside the review RPC. Approval matrix: ADA ← DA/AG/
  Owner, DA ← AG/Owner, AG ← Owner, Judge ← Owner. Separate
  `justice_membership_requests` table + `review_justice_membership_request()`.
- **Bureau-aligned ADA coverage** via `prosecutor_bureau_assignments`
  (assignments, not roles): one active primary + one active acting per bureau,
  routing precedence acting → primary, DA/AG/Owner manage assignments, ended
  assignments preserved. `doj_bureau_coverage()` powers the coverage board.
- **Legal requests** (`legal_requests`) with three independent status
  dimensions (document / review / fulfilment), **immutable submitted versions**,
  append-only history, deliberately-selected exhibit packets, request-specific
  participants, and version-bound signatures. Responsible bureau resolves to
  `cases.bureau` (ordinary) or `cases.originating_bureau` (joint/JTF); legacy
  JTF cases must set the originating bureau first.
- **Warrant workflow** (always Judge-approved) and **subpoena workflow** (DA /
  AG / Judge routes by type), with issue / execution / return / service /
  compliance tracking — all CID-side, all preserving the existing
  evidence/chain-of-custody system. **Submit for Legal Review** on a finalized
  arrest-warrant report spins up the linked legal request.
- **Classification ladder** (standard / restricted / classified / sealed);
  sealed requests are undiscoverable to unauthorized users via search, counts,
  badges, or notification details. A server-side **MDT wanted-status contract**
  (`mdt_wanted_projections`) holds only classification-safe fields; no external
  endpoint exists yet.
- **Justice portal** (role-scoped queues, coverage board, membership approvals,
  DOJ personnel) — the whole app for justice-only users; a sidebar leaf for
  dual-identity users and the Owner. New CID **Legal Requests** tab.
- Every legal table is SELECT-only for clients; all transitions run through
  transactional SECURITY DEFINER RPCs. Live RLS suite grew to **99/99** (37 new
  DOJ assertions); 5 new Justice E2E specs. A NULL-guard hardening migration
  (`20260714070000`) — caught by the live suite — closed a
  `NULL in (...)`-skips-the-raise gap in the justice authorization helpers.

## [1.12.0] — 2026-07-13

### Added — deny login (app-level access block)
- Command and the Owner can now **deny a person access** to the portal from
  **Manage Officer → Danger zone → Deny login access** (with a reason shown
  to the member), and **Restore login access** to reverse it. Bureau leads
  are scoped to their own bureau and cannot deny a command member or the
  owner; nobody can deny themselves — all enforced server-side by the
  `deny_member_login()` / `restore_member_login()` definer RPCs.
- A denied person can still authenticate but lands on an **"Access denied"**
  screen (showing the reason) instead of the membership-request form, and is
  blocked from filing or advancing a request — closing the gap where a
  removed or rejected person could simply sign back in and re-apply.
  Reversible; deny/restore are audit-logged and notify the member. Restoring
  returns them to inactive so they re-enter the normal request→approval flow.
- The `login_denied*` columns are frozen against direct client writes by a
  dedicated non-definer trigger (a denied user cannot self-clear the block —
  covered by a new RLS test).

## [1.11.0] — 2026-07-13

### Added — membership requests (new-member onboarding)
- A new sign-in now lands on a **membership request form** instead of a
  dead-end pending screen: display name, badge, **exactly one permanent
  department** (LSB/BCB/SAB — JTF is joint-case-only and cannot be
  requested), a requestable role (Detective / Senior Detective), and a
  reason. Requests are draft → pending → (correction ↔ resubmit) →
  approved / approved-with-changes / rejected / withdrawn, with an
  append-only history and audit-log entries.
- **Command review** lives in the Command Center Approval Queue: approve
  as requested, approve with changes (final dept/role selectors,
  bureau-lead scoping mirrors `assign_member`), request correction
  (applicant-visible note + Command-only internal note), or reject.
  The profile's role/division/activation change **only** inside the
  `review_membership_request()` RPC, atomically with `role_events`,
  history, audit and the applicant's notification. Internal notes are
  column-revoked from clients (profiles.email precedent).

### Added — joint cases (temporary cross-department access)
- **Make This a Joint Case** on a case (lead/creator/command): pick
  members from a searchable roster (name/badge, department filter), give
  each a **temporary joint-case role** (JTF Case Lead, JTF Co-Lead, Joint
  Investigator, Support Investigator, Department Liaison, Read-Only
  Member) and an optional **access expiry**. The case shows a JTF tag and
  keeps its **originating department** — `cases.bureau` is deliberately
  never flipped to JTF (in this schema that would mean division-wide
  visibility).
- Access is enforced by RLS: an active, unexpired joint assignment grants
  access to **exactly that case** (`private.has_joint_access`). Members'
  permanent departments/roles never change; they gain nothing on other
  cases. Joint assignment rows are **RPC-only** (direct client writes to
  `case_assignments` stay limited to today's inert standard rows).
  Removal revokes immediately, expiry is server-enforced, **End
  Joint-Case Status** closes everything at once, and history is never
  hard-deleted. All actions notify the affected members and audit-log.

### Added — announcement audiences & portal @everyone
- The composer now targets **Everyone** (`@everyone` — Deputy Director+
  and owner only), **Command**, **My Department**, a **specific
  department** (bureau leads: own department only), or **specific
  members** (`specific_members` — exactly the mentioned users). Typing `@everyone` selects the
  Everyone audience when authorized.
- Publishing goes through the **`publish_announcement()` RPC**: recipients
  resolved server-side (active members only, deduplicated, one
  notification each), with a live **recipient-count preview** and a
  confirmation before broadcast. Announcement visibility is now
  RLS-scoped per audience (previously client-side only).
- **Edits never re-notify automatically** — an explicit "Notify recipients
  about this update" option (default off) sends one update notification.
- Discord: a new `discord-announce` edge function performs one
  rate-limited server-side DM sweep per broadcast (failure never affects
  the portal records). Also fixed the existing `discord-notify` function,
  which filtered on a non-existent `notifications.created_by` column and
  therefore never delivered any DM.

### Verification round (pre-merge checks)
- Audience value `members` renamed to **`specific_members`** for clarity
  (data, CHECK, RLS, helper, UI).
- Fixed a projection bug the new E2E suite caught on its first live run:
  the applicant form's default `select('*')` (and insert/update returning)
  tripped the revoked internal-note column and 403'd for every applicant —
  `insert`/`update` now take an explicit projection and the form uses one.
- Fixed a stale smoke-spec assertion ("Back to cases" became the Cases
  breadcrumb in v1.6); both smoke tests pass live again.
- RLS fixture accounts recreated (they had been deleted with the other
  test accounts), including a new disposable `rls-test-applicant`;
  `rls_test_cleanup()` extended to the new tables; test-applicant
  submissions never notify real command members.

### Changed — CID warrant form corrections (confirmed form)
- Arrest Warrant Request gains **Warrant Title**, **Priority**
  (Medium/High/Critical — never bypasses review) and a structured
  **Evidence / Supporting Links** section with pickers for case evidence,
  case attachments and **finalized case reports** (free text still
  allowed). Suspect-type fields across all report forms now capture the
  **canonical person record id** alongside the display name whenever the
  typed name matches the Persons registry, and saved reports link them.
- No DOJ functionality was implemented; `docs/archive/DOJ-INTEGRATION-DRAFT.md`
  (proposal-only) covers roles, warrant/subpoena lifecycles, court
  packets, classified requests, versioning and MDT projection.

## [1.10.0] — 2026-07-13

### Changed — D1: command dashboard declutter
- The nine KPI cards compact into tighter tiles under a **Division vitals**
  header — same numbers, same click-to-drill, less scrolling.
- The embedded **Crime Analytics** block is now a collapsible section
  (open by default, nothing removed) with a **Full analytics →** shortcut
  to the dedicated Analytics tab.

### Changed — D4: Intelligence navigation grouping
- The Intelligence sub-tab strip visually groups its 12 tools —
  **Registries** (Persons, BOLO, Gangs, Places, Vehicles, Indicators),
  **Analysis** (Network, Narcotics, Ballistics, M.O. Detector) and
  **Archive** (Media Vault, Records) — with dividers and labels (labels
  hide on narrow screens). Same tabs, same order, same routes; purely a
  visual layer, so deep links and vanilla parity are untouched.

## [1.9.1] — 2026-07-13

### Fixed — case Timeline tab froze the page
- Opening a case's **Timeline** tab crashed the browser tab: on the first
  render (before the case's events load) the chronology band computed an
  infinite time range and its axis-tick loop never terminated. The range
  is now pinned to a finite window and the loop is hard-capped.

### Security — seal hardening (review follow-up)
- **Reopen is bureau-scoped**: a bureau lead can only unseal reports on
  their own bureau's cases (JTF cases are shared, matching case access);
  deputy director and director remain unrestricted. Permission is now
  checked before report state is revealed.
- **The previous signature survives a reopen** — it is preserved in the
  report's history (`fields._reopen_log`) instead of being erased.
- **Warrant status changes go through a validating RPC**
  (`warrant_set_status()`): status whitelist, warrant templates only, and
  the actor is stamped server-side into the warrant log. Direct client
  writes to a sealed report's warrant fields are now blocked entirely —
  the RPC is the only path, so the in-record trail can't be forged.

## [1.9.0] — 2026-07-13

### Changed — reports open in-page, not in a popup
- Clicking a saved report now opens it **inside the Reports tab** (with a
  "← Back to reports" control) instead of a modal. The header shows
  Draft/Sealed and — for warrants — the warrant status chip; Finalize,
  Edit, Delete and Download .md live in the same bar.
- Referenced content is **clickable**: evidence entries expand to their
  logged details (type, collected by, tamper seal), attachment entries
  open their file link, and suspect/witness/target names that match the
  Persons registry jump to that person's profile.

### Added — seal & reopen with confirmations
- **Finalize now asks for confirmation** and lists any still-empty key
  fields before sealing (you can seal anyway). A sealed report's contents
  are locked (enforced server-side).
- **Reopen** (bureau lead and above): breaks the seal with a confirmation,
  removes the signature, and makes the report editable again — backed by a
  new `report_reopen()` definer RPC gated on `private.is_command()`.
  Reopening is audit-logged like every write.

### Added — warrant lifecycle control
- Warrant reports (arrest / search / wiretap) get a **status selector**
  (draft → signed → executed → returned) in the report header. The status
  was always *displayed* on the BOLO board, case graph, and person
  profiles but nothing could change it. Each change appends to the
  warrant log inside the report and works on sealed warrants too (the
  database has always allowed exactly this).

### Changed — report forms render as designed (bundle B)
- Checkbox fields (supporting evidence, items to seize, basis,
  surveillance type, subpoena type, method) render as **real checkbox
  chips** instead of empty text boxes; legacy comma-joined values load.
- **Money fields** get a $ prefix and numeric keypad; inventory-style
  tables show display-only per-column totals.
- Dropdown columns inside tables (e.g. premises type) render as actual
  dropdowns.
- Every field now has a **persistent label** — names no longer vanish
  once you type (previously placeholder-only).

### Added — form conveniences (bundle C)
- Suspect/target/witness name fields **suggest names from the Persons
  registry** (free text still allowed).
- Date/time fields get a one-click **Now** button.
- The evidence/attachment pickers extend to the **UC Operation** report
  (intelligence table + media references) and the **Surveillance
  Report** (media references).

### Fixed — editing no longer renumbers a report
- Saving an edit now changes only the report's contents; its kind,
  sequence number and author stay as filed. New reports derive their
  kind from the chosen Report Type, so supplementals are numbered
  correctly.

## [1.8.2] — 2026-07-13

### Fixed — picked evidence/attachments are removable
- Items added via **Add from case evidence / Add from case attachments** now
  appear as chips with a **✕** button in the Evidence / Property section —
  previously an added entry (including its link) could only be removed by
  hand-editing the text. The underlying fields are unchanged ('; '-joined
  strings), so free text and previously saved reports render exactly as
  before.

## [1.8.1] — 2026-07-13

### Changed — saved reports render styled, not as raw text
- Opening a saved report now shows it **styled like the rest of the site**:
  each form section becomes a card with a header, key-value rows, a real
  table for suspect/witness rows, and readable paragraphs for narratives —
  instead of the previous monospace text dump. The **Download .md** button
  is unchanged and still exports the markdown flattening.

### Fixed — report rows can be removed
- Grid sections in the report editor (e.g. *Suspect / Witness Information*)
  gain a per-row **✕ Remove** button next to **Add row** — previously a row,
  once added, could not be deleted.

## [1.8.0] — 2026-07-13

### Added — evidence lookup while writing a report
- The **Evidence / Property** section of the CID Investigative Report gains
  two pickers: **Add from case evidence** and **Add from case attachments**.
  They list **only** items already attached to the case (the Evidence tab's
  `evidence` rows and the case's attachments) and append the chosen item
  (`EV-001 — description` / attachment title) into the existing fields — no
  retyping, no schema change, drafts/finalize untouched. If nothing is
  attached yet, the form says so and points to the Evidence tab.

### Added — person & vehicle profile pages
- **Person profile** (`/persons?person=…`, shareable/back-button friendly):
  identity card (mugshot, name, BOLO/felony badges, status + alias) with
  key-value rows for the fields the app stores (gang, CCW, VCH, felonies,
  BOLO, DOB when present), plus panels for **Warrants** (derived from case
  reports), **Vehicles**, **Properties**, **Linked cases**, **Media**, and
  **Notes**. The Persons card's Profile button now opens this page; the
  quick-look drawer is unchanged where other views use it.
- **Vehicle profile** (`/vehicles?vehicle=…`): details card (model, mono
  plate, color swatch, owner → linked to their person profile, gang chip)
  with **Linked cases** derived from plate mentions in reports plus the
  owner's case links (fail-closed with Retry — never a false "no cases"),
  and **Notes**. Vehicle cards gain a Profile button; the registry, search,
  cross-case scanner and edit modal are unchanged.
- Both pages reuse the shared design-system primitives, stack on mobile,
  respect reduced motion, read via RLS-scoped queries only, and invent no
  fields the database doesn't store.

## [1.7.2] — 2026-07-12

### Phase D3 — Case-detail tab bar & header (visual + a11y)
Polish on the most-used screen — surgical, single-file; the 12 tabs, their
order, `?tab=` deep-links, and every tab/action/workflow are unchanged.
- **Sticky tab bar** below the shell header (`top-[4.5rem]`/`sm:top-[4.75rem]`,
  `z-10`, blurred background) so it stays visible while scrolling long tabs
  (evidence, timeline).
- **Overflow fades** on the tab strip that track the real scroll position
  (left when scrolled, right while more remains); the active tab scrolls into
  view on load and on change (reduced-motion-safe).
- **Accessible tablist** — `role="tablist"/tab/tabpanel"` with stable
  `id`/`aria-controls`/`aria-selected` pairs and **roving tabindex**:
  Left/Right/Home/End move focus, Enter/Space/click activate. Focus movement
  is separate from activation, so the URL isn't churned as focus roams.
  Tab targets are ≥44px on mobile.
- **Record / workflow divider** — one hairline before `reports` groups the
  workflow cluster (reports · tasks · sign-off · chat) without reordering.
- **Sign-off attention marker** — a dot on the Sign-off tab **only** when the
  case is awaiting a decision (`signoff_status` `awaiting_*`), with an
  `sr-only` + `title` "Sign-off requires attention" (never dot-alone).
- **Header chips** tidied via shared `Badge` into identity (case# · bureau) and
  workflow (status · sign-off · stale) groups; same data + tint helpers.

## [1.7.1] — 2026-07-12

### Phase D5 — Developer Handbook reading polish (owner/dev-only, visual)
Long-form readability on the handbook chapters; no content, generation,
gating, or routing changes.
- **Capped reading measure** — the article column is centered at `max-w-3xl`
  (~72ch) so lines stay readable on wide screens; tables and code blocks keep
  their `overflow-x-auto` and scroll within the measure.
- **"On this page" TOC** (`OnThisPage.tsx`) — built from the existing
  `docHeadings()`: a sticky right column at `xl`, a collapsible block above the
  article below `xl` (≥44px summary). h3 indented under h2; clicks reuse the
  existing `goTo` deep-link.
- **Scroll-spy** — one lightweight `IntersectionObserver`, a single active
  heading at a time, resilient when nothing is intersecting (keeps the last),
  reduced-motion-safe, and it **never writes the URL hash while scrolling** —
  the hash changes only on explicit navigation.
- **Hover/focus heading anchors** — a subtle `#` appears on heading hover or
  keyboard focus, with an accessible "Link to section: …" label, for copyable
  deep-links.

## [1.7.0] — 2026-07-12

### Phase D2 — Owner Portal cleanup (visual only)
Readability and consistency pass on the owner console — no schema, workflow,
RPC, permission, routing, or dependency changes; all data, triage logic, and
owner-gating unchanged.
- **Readable type scale + AA contrast** — bumped the pervasive
  `text-[9/10/11px]` labels to `text-xs`, body to `text-sm`, and muted text to
  `slate-400`; genuinely tabular data stays compact.
- **Design-system adoption** — the local `Panel`/`Notice` now compose the
  shared `Card`/`SectionHeader`/`Notice`/`EmptyState`/`ErrorNotice`; status /
  priority / type chips render via `Badge` (keeping the domain-correct
  feedback tint maps); owner inputs use the shared `Field` styles.
- **Grouped desktop navigation** — the flat 11-item rail is grouped under
  Overview / Monitor / Improve / Understand / Operate (same ids + `?s=`
  deep-links), with a left accent bar on the active item. Mobile keeps its
  section `<select>` picker.
- **Overview KPI strip** — a compact 4-card row (Database · Open feedback ·
  Realtime · Last deploy) that deep-links via `?s=`. It **reuses** values the
  Health and Feedback sections already fetch (a tiny `ownerVitals` store) —
  Overview never fetches — and degrades to a graceful "—/not checked yet"
  until those sections have run.
- **Feedback inbox** — the nine filter views become a cleaner segmented
  control; every triage action and RPC preserved.

### Also in this release (developer tooling — no runtime impact)
- Dedicated-test-project harness scaffold (Playwright functional + visual,
  seed/reset, self-skipping CI) — dormant until a test DB + secrets are
  configured; see `docs/TEST-ENVIRONMENT.md`.
- Added development-tooling configuration under `.claude/agents/`.

## [1.6.0] — 2026-07-09

### UI/UX modernization pass (polish, not a rebuild)
Identity, workflows, permissions and data behavior are unchanged — this
release makes the existing design consistent, safer and more accessible.

#### Design system
- New shared primitives in `src/components/ui/`: **Button** (primary /
  secondary / danger / ghost — one danger shade), **Card** (padding scale,
  canonical border), **Badge**, **Field / Input / Select / Textarea** (+
  exported `inputCls`/`labelCls`, replacing 8+ local copies),
  **PageHeader / SectionHeader**, **Breadcrumbs**, and
  **Notice / EmptyState / ErrorNotice** (replacing 23 copy-pasted `Notice`s).
- New `lib/tint.ts` — one `statusTint`/`priorityTint`/`roleTint` home. The
  case-status colors are now a single map shared by the board, the case
  header, the Command drill pill and the guide legend; the Command pill had
  silently drifted (showed *open* as blue where the board shows amber) and is
  realigned. Command Center / Profile / Operations card borders normalized to
  the app-wide `border-white/5`.

#### States & microcopy
- Registry views show **card-grid skeletons** on first load instead of a
  "Loading…" line; empty states explain what to do next (with a
  call-to-action where you can act); ALL-CAPS "terminal" empties retired.
- Load failures now show a humanized message with **Try again** — raw
  database errors no longer reach the screen, and the 7 views that silently
  showed an empty list when a fetch failed now say so.
- Case board toast reads "Case marked Active." instead of `Status -> ACTIVE`.

#### Safety
- The 6 case-tab deletes that fired instantly (assignments, tasks, chat
  messages, intel links, RICO predicate acts, case templates) now confirm
  with specific dialogs that name the item, warn about related records, and
  keep the 6-second **Undo** (task sub-tasks are snapshotted and restored).
- **Closing a case** (quick-status or drag to Closed) asks for confirmation
  and explains how to reopen.

#### Mobile & navigation
- The **notifications bell** is now visible below desktop width (it was
  completely hidden on phones) and a **search button** opens the search
  palette on mobile; header touch targets are 44px.
- **Breadcrumbs** on case and operation detail replace the bare "Back to X"
  links; the sidebar's active item gains a left accent bar.

#### Accessibility
- One real `<h1>` per view via PageHeader; heading outlines fixed.
- Form labels programmatically associated (`htmlFor`/`id`) across ~20 form
  files; modals expose `aria-labelledby`; RichEditor toolbar buttons are
  labelled and the editor shows a visible focus ring.
- Muted informational text bumped `slate-500` → `slate-400` (WCAG AA);
  small card action chips enlarged to ~40px hit areas without layout shift.

## [1.5.0] — 2026-07-09

### Added — Command Center
- A new top-level **`/command-center`** tab: the single home for command
  administration, gated to command roles (Bureau Lead / Deputy Director /
  Director) and the portal owner. The visible gate is UX only — every action
  still flows through the existing SECURITY DEFINER RPCs and RLS
  (`private.is_command()` / `is_owner()`), which remain the real wall.
  Section-nav pattern with `?s=` deep-links (mirrors the Owner Portal):
  - **Overview** — command KPIs (pending approvals, sign-offs awaiting you,
    active officers, on-LOA) that deep-link to the relevant section.
  - **Chain of Command** — org chart from the roster (owners → director →
    deputies → per-bureau leads/seniors/detectives) plus the sign-off chain.
  - **Personnel & Admin** — the AdminPanel + AssignModal member-management
    controls, **moved here** from the Personnel tab.
  - **Approval Queue** — pending member approvals (one-click approve) plus
    sign-offs awaiting your decision, deep-linking to the case sign-off tab.
  - **Promotions & Transfers** — officer search + role/bureau changes, with a
    **role-change history** from the new `role_events` table.
  - **Duty Status** — active / on-duty / LOA counts and per-bureau officer
    lists.
  - **Permissions** — the access matrix (reuses the Owner Portal matrix).
  - **Announcements & Analytics** — embeds the announcement composer and the
    division analytics view.

### Changed
- **Personnel** is now a read-only member-facing directory: member
  administration (approve / manage / promote / transfer / remove) moved to the
  Command Center. Command staff see a link banner; officers keep their own LOA
  toggle and an "edit my profile" shortcut. The existing sign-off, member
  approval, owner-only audit and dashboard/analytics tabs are unchanged.
- Extracted the shared `canReviewCase()` sign-off predicate to
  `command-center/lib/approvals.ts` (used by both the Inbox and the Approval
  Queue).

### Security / Database
- New **`role_events`** history table (actor, target, old/new role/division/
  active), populated only by the `assign_member` RPC; command-readable RLS,
  realtime-published.
- **`assign_member` tightened for Bureau Leads**: a non-owner Bureau Lead may
  only manage members **in their own bureau**, may **not** promote above
  `senior_detective`, may **not** transfer members out of their bureau, and may
  **not** manage other command staff. Deputy Director / Director / Owner scope
  is unchanged (broader). Enforced in the database, not just the UI.

## [1.4.0] — 2026-07-09

### Added — native profile & settings page
- A member-facing **`/profile`** page (standalone leaf tab, all signed-in
  members) reachable from the sidebar officer card, the header name, the
  sidebar Appearance button, and Personnel's "edit my profile". Sections:
  - **Profile** — editable display name, badge number, **avatar** (image URL,
    **FiveManage upload**, or reset-to-provider), and **Discord link** for
    DMs, plus the LOA self-toggle. Saves via `updateNoSelect`; role/bureau/
    activation stay read-only (frozen by `guard_profile`).
  - **Appearance** — accent + density (device-local `localStorage`), applied
    live. Notes the portal is single-dark-theme.
  - **Account & security** — read-only email, sign-in providers, account
    created / last sign-in, User ID, plus **Sign out** and **Sign out
    everywhere** (global scope). No password form (OAuth / magic-link only).
  - **Notifications** — informational: in-app bell always on; Discord DMs
    gated on the linked Discord ID.

### Changed / Removed
- Replaced the `MyProfileModal` and `AppearanceModal` with the new page; all
  four entry points now open `/profile`. Extracted `applyAppearance()` +
  accent/density constants to `src/lib/appearance.ts`. Guide references updated.

## [1.3.1] — 2026-07-09

The "polish" half of the v1.3 phase — accessibility and loading states.

### Added
- **Loading-skeleton primitives** (`src/components/ui/Skeleton.tsx`):
  `Skeleton`, `CardSkeleton`, `CardGridSkeleton` built on the existing
  `.skel` pulse (reduced-motion-safe). First-fetch states now render the
  *shape* of the incoming content instead of a bare "Loading…" line;
  applied to the Indicators and Gangs registries as the pilot.

### Fixed
- **Accessibility — main landmarks.** The screens that render outside the app
  shell (the auth **Gate**, the route **error boundary**, **404**, and the
  init shim) had no `<main>`, so axe flagged `landmark-one-main` and `region`
  (content not in a landmark) on those states. Each now supplies its own
  `<main>`. WCAG 2.1 A/AA scans across the pages are clean; these were the
  remaining best-practice findings.

*(The Lighthouse-budget item from the v1.3 plan is deferred — tracked in
`docs/CTO-REVIEW.md`.)*

## [1.3.0] — 2026-07-09

The "pattern & debt" half of the v1.3 roadmap phase (the accessibility,
skeleton, and Lighthouse-budget items followed separately).

### Added
- **`src/lib/useRegistry.ts`** — the shared skeleton behind every list screen
  (rows/loading/error state, a sign-in-gated `refresh`, and a deferred,
  realtime-version-driven refetch), extracted so a view supplies only its
  query. **Piloted on the Indicators registry**; the hook returns `refresh`
  and `setRows` so filtering/modals/delete stay in the view.

### Changed
- **`GangsView.tsx` split** (693 → 196-line container) into
  `gangShared.tsx` (types/constants/helpers/Notice), `gangModals.tsx`
  (gang/member/turf/attach modals) and `gangCards.tsx` (card + detail +
  member card) — the last remaining monolith. Also migrated to `useRegistry`.
- More jsonb read boundaries routed through `src/lib/jsonShapes.ts`: case
  template checklists (`CaseModal`) and media tags/labels (`MediaView`) now
  use the shared `parseStringArray` / `parseFormValues` instead of
  re-implementing the guard inline.

## [1.2.0] — 2026-07-09

The "close the loop" ops release — the operational leg the CTO review
(`docs/CTO-REVIEW.md`) flagged as weakest. No new member-facing features.

### Added — monitoring & error tracking
- **In-app error tracking.** `src/lib/errorReport.ts` reports uncaught
  exceptions and unhandled rejections to a new `client_errors` table
  (deduplicated, capped 5/session, noise-filtered). Owners see them in
  **Owner Portal → Health → Client errors** and get a bell notification
  (`client_error` type), throttled by a DB trigger to one per 15 minutes.
  Live migration `client_errors_table`; verified end-to-end (member insert,
  owner read, non-owner denied, owner ping fired, cleaned up).
- **Operations runbook** (`docs/RUNBOOK.md`): monitoring signals, incident
  response, backup/restore drill procedure, and disaster-recovery options
  including the recommended baseline-migration squash.

### Added — CI & tests
- **`security-suites` CI job** runs the RLS suite (and, with a browser, the
  E2E smoke) whenever the `RLS_TEST_PASSWORD_*` repository secrets exist;
  self-skips otherwise, so forks stay green.
- **Owner-positive RLS tests** + a fourth `rls-test-owner` account: proves
  the owner's triage-write and audit-read paths *work* (the block that would
  have caught the v1.1.1 `is_owner` grant bug before shipping). 22 RLS tests.
- **`check:schema`** — offline CI check that `schema-snapshot.sql` and
  `database.types.ts` agree on every table/column, both directions.
- **`gen:guide`** — the in-app User Guide is now generated from
  `docs/USER-GUIDE.md` (mirror of `gen:handbook`) with a CI drift check.

### Added — never-lose-work
- Report editors now persist drafts per case/template (and per report when
  editing), restore them on reopen, and clear on save — extending the case
  chat draft behavior to the report forms.

### Fixed
- `SETUP.md` `is_owner` bootstrap now shows the correct recipe (the
  `profiles_guard` trigger makes the flag immutable even for direct SQL; it
  must be disabled around the update).

### Database
- Live migration `client_errors_table`; schema snapshot regenerated (49
  tables, 40 functions, 171 policies); `MIGRATION-HISTORY.md` → 79 entries.

## [1.1.1] — 2026-07-09

The testing investments from the review (suggestions #9 and #10) — and the
live bug the first run caught.

### Fixed
- **`private.is_owner()` was missing its EXECUTE grant**, so every statement
  whose RLS evaluation touched an `is_owner`-based policy failed with
  `permission denied` for *all* authenticated users: member feedback
  submission, the owner's triage writes, and the owner's audit view. Found by
  the new RLS suite on its first run; fixed live (migration
  `grant_execute_is_owner`).

### Added
- **RLS/RPC security-wall suite** (`npm run test:rls`, 17 tests): bureau
  isolation, deny-by-default, sign-off/finalize lockdown triggers, RPC caller
  checks, owner gates, `is_owner` self-grant immunity, the email column
  grant, and anonymous access — running against the live project as three
  dedicated `rls-test-*` accounts (detective LSB / detective BCB / inactive).
  Opt-in via env credentials; teardown via the new `rls_test_cleanup()` RPC
  (callable only by the test accounts, deletes only rows they authored).
- **Playwright E2E smoke** (`npm run test:e2e`): signed-out gate →
  programmatic session (password grant) → shell → create a case through the
  real UI → detail renders → cleanup. Same opt-in credentials.
- Live migrations: `rls_test_cleanup_rpc`, `grant_execute_is_owner`,
  `rls_test_cleanup_case_files_fix`; schema snapshot + migration history
  regenerated (78 live migrations, 38 functions).

## [1.1.0] — 2026-07-09

The remaining "safe now" improvements from the post-release review
(suggestions #4, #6, #7, #8).

### Added
- **Keyboard & screen-reader path for board status moves**: every case card
  on the board now carries a compact status select (edit-capable users), so
  drag-and-drop is no longer the only way to move a case between columns.
- **Heatmap without color reliance**: map dots now print the intensity
  number in their label, the footer legend maps each dot color to its
  numeric range, and dots are keyboard-focusable (Tab + Enter opens the
  area's records).
- `src/lib/jsonShapes.ts` — dependency-free runtime parsers for the loose
  `jsonb` columns (`cases.charges`, `reports.fields`, tags/mentions
  string-arrays). Every read boundary now degrades malformed rows to safe
  fallbacks instead of trusting a cast; unit tests included (17 tests total).

### Changed
- **`CaseDetail.tsx` split into per-tab files** (`cases/tabs/` — 12 tabs +
  shared helpers, 849 lines → ~240 line composer). Pure mechanical
  extraction; `RicoTab` is re-exported for RicoView.
- Owner Portal suggestions now show a **done \<release\>** badge on shipped
  items (8 of 14 marked).

### Documentation
- Historical build-era docs (`HANDOFF`, `PHASE2-HANDOFF`, `ROADMAP`,
  `REACT-PARITY`, `BACKLOG`, `superpowers/`) moved to `docs/archive/` with
  an index README; all inbound references updated; handbook regenerated.

## [1.0.1] — 2026-07-09

Housekeeping + one live bug fix.

### Fixed
- **Feedback triage inbox was fully broken**: the `private.audit()` trigger
  assumed every audited table has an `id` column, so every write to
  `feedback_meta` (primary key `feedback_id`) failed. The trigger now derives
  the entity id tolerantly (live migration `audit_trigger_tolerant_pk`);
  identical audit rows for all id-keyed tables.
- Case chat now **persists unsent drafts** per case (`src/lib/drafts.ts` was
  shipped but never wired): a draft survives navigation/refresh, restores on
  return, and clears on send.

### Removed
- Unused dependencies `react-hook-form`, `zod`, `@tanstack/react-query`
  (never imported; ~2.6 MB of `node_modules`).
- Dead privileged SQL: `public.bootstrap_command` / `public.bootstrap_director`
  (SECURITY DEFINER escalation-by-email helpers; already unexecutable by
  clients, dropped from the live DB — live migration `drop_bootstrap_functions`).
  `SETUP.md` now bootstraps the first Command user with a direct `update`.

### Documentation
- `supabase/schema-snapshot.sql` — generated reference snapshot of the full
  live schema (48 tables, 168 RLS policies, 37 functions, 56 triggers, enums,
  indexes, grants, realtime publication).
- `supabase/MIGRATION-HISTORY.md` — all 75 live migrations mapped to their
  repo files; the 21 live-only ones are now itemized instead of implied.

## [1.0.0] — 2026-07-09

First stable release of the **React platform** (Next.js 16 + Supabase),
declaring the post-cutover application production-ready.

### The platform (cutover + parity)
- Full React/TypeScript rebuild of the vanilla portal — 29 member screens,
  RLS-authoritative Supabase backend, realtime everywhere (#61 cutover and
  the parity waves before it; legacy runtime removed in #105).

### Features since cutover
- Live upload fix for case attachments (#103); audit/completion sweep with
  watchlist, silent-failure hardening and the My Desk Following panel (#104)
- In-app User Guide (#105), mention + heatmap improvements (#106)
- Checklist templates + division calendar (#107)
- Investigation graph (#107), court-styled PDF exports (#108, CSP #109),
  ⌘K command palette (#110), Tiptap rich editor + interactive heatmap (#111)
- Division analytics, indicators registry with deconfliction, zoomable case
  chronology, DataTable engine with CSV export, graph v2 (#112)
- Visual-first User Guide (#113)
- Security/performance hardening: anon RPC lockdown, 68 FK indexes, custom
  error screens, first unit tests, CI, Dependabot (#114)
- Documentation platform: developer handbook (#121), README/docs audit,
  in-app Developer Handbook, **Owner Portal & Control Center** with the
  is_owner role and the feedback triage inbox (#122)

### Database (live migrations, additive)
`case_templates.tasks`, `indicators`, `security_hardening_and_fk_indexes`,
`owner_role_and_feedback_meta`, `grant_is_owner_select` — the live schema
is the source of truth (mirrored in `src/lib/database.types.ts`).

---

# Pre-1.0 development log (vanilla era)

## Deep audit & verification fix pass (2026-07-02 → 2026-07-05)
- A full-codebase security/correctness audit of the vanilla SPA (against the
  deployed database security surface) confirmed 45 findings — 1 critical
  stored XSS via notification payloads and 8 high, including a second stored
  XSS and a tracker dual-authorization enforced only client-side — all fixed.
- A follow-up verification pass caught and closed 7 further defects
  (stale-cache data-loss sinks, remaining unguarded `src`/`safeUrl()` sinks,
  CSV formula-injection). Full records:
  [`docs/archive/AUDIT-REPORT.md`](docs/archive/AUDIT-REPORT.md) +
  [`docs/archive/AUDIT-VERIFY.md`](docs/archive/AUDIT-VERIFY.md).

## Link intel directly to a case (2026-06-22)
- New **Intel tab** on the case detail view: link a **person, gang, or place**
  directly to a case as a "person/gang/place of interest", with an optional role
  (Suspect, Witness, Victim, Associate, Location, …). Each linked item lists with
  a `profile →` jump (persons/gangs open the intel slide-over) and an unlink (✕)
  control; a kind/entity/role picker adds new links, excluding anything already
  linked. This complements the *indirect* links that already surface intel on a
  case (`gang_members.case_id`, `media`, `ballistic_footprints`, `places.case_id`)
  with an explicit, first-class attach.
- The links are **bidirectional**: a person/gang linked from a case now also
  appears in that entity's intel-profile **"Linked cases"** rollup.
- Backed by a new **`case_intel_links`** join table (polymorphic
  `kind ∈ {person, gang, place}` + `ref_id`, unique per `(case_id, kind, ref_id)`,
  optional `role`/`note`). RLS mirrors the bureau-isolation model — select / insert
  / delete all gated on `private.can_access_case(case_id)`, so a link is only
  visible and editable to someone who can already work that case; no UPDATE
  (links are immutable — re-target by unlink + relink). A deleted or
  cross-bureau target degrades to "Deleted / no access" rather than erroring.
- Migration `20260622120000_case_intel_links.sql` is **prepped in-repo but NOT yet
  applied to live `cid`** (pending approval, per the repo's migration convention).
  Until it is applied the Intel tab shows a "run migration" banner and stays
  read-only-empty; no existing data or view is affected.

## SheetJS upgrade — 0.18.5 → 0.20.3, off npm CDN (2026-06-20)
- The Excel (`.xlsx`) import/export library now loads the latest SheetJS
  Community Edition (**0.20.3**) from the **official** `cdn.sheetjs.com` instead
  of npm's `xlsx@0.18.5` via jsdelivr. npm's 0.18.5 is the last release the
  SheetJS team published to npm; it is no longer maintained there and carries
  known advisories (**CVE-2023-30533** prototype pollution + a ReDoS). The
  current build is published only on the authoritative SheetJS CDN.
- Drop-in swap: all call sites (`XLSX.utils.book_new`, `book_append_sheet`,
  `aoa_to_sheet`, `json_to_sheet`, `writeFile`, `read`, `sheet_to_csv` in
  `app.js` / `core.js`) are unchanged — the public API is stable across the
  upgrade. The existing offline guard (`if (!window.XLSX)`) still applies.

> **Note — numbering.** The `## Phase 1` … `## Phase 11` headings below are the
> *original 2026-06 build waves* of the vanilla-era app. They are UNRELATED to
> the records/requests **10-phase roadmap** (Phase 1 … Phase 10) documented in
> the top `[Unreleased]` section; do not conflate the two schemes.

## Phase 11 — Gap-close patch: numbering, isolation, FiveManage, heatmap, shifts (2026-06-17)
- **§1 Case numbering** — manual, unique, bureau-prefixed `BUREAU-NUMBER` (e.g.
  `SAB-900023`). Auto-gen removed (`nextCaseNumber`). UI validates the pattern,
  **enforces** the prefix matches the case's bureau, **warns** (not blocks) on the
  leading-digit convention (LSB→1 BCB→2 SAB/JTF→9). DB unique index on
  `cases.case_number`; duplicate → clear inline error. Ticket→case wizard now manual.
- **§2 Bureau isolation (RLS)** — cases + casework children (evidence, custody,
  reports, signoff, assignments, raid-comp, M.O., RICO, predicate acts, trackers,
  case_files) are visible only to the case's bureau. **JTF is shared**; only
  command/director cross-cut; owner/lead/grants still apply. **Chat-visibility rule
  changed**: the old "same-department can read case chat" is superseded by full
  bureau isolation (chat already keyed off `can_access_case`, so it tightened with
  it). M.O. cross-bureau secrecy preserved via a `mo_crossref` SECURITY DEFINER RPC
  (returns case number + shared tags only → "flagged elsewhere, request access").
- **§3 FiveManage** — real upload module (`fivemanage.js`, `window.CID_FIVEMANAGE`)
  wired into the Media vault: upload photo/video → FiveManage → store URL+metadata
  in `media` (case/gang/location/person tags, view, delete by RBAC). Graceful guard
  when unconfigured. **Google Drive stub left intact** (separate `case-files` tab).
- **§4 Commander Heatmap** — new tab: case/turf/place/raid concentration by area,
  driven by live data, bureau-scoped (uses RLS-filtered caches). Added `cases.area`.
- **§5 Weekly shift reports** — `shift_reports` table (RLS rollup to bureau
  leadership + command, realtime) + `shifts.js` tab (file weekly report; leads/
  command see their scope).
- **§6 Tailwind** — already precompiled into `styles.css` (no CDN, no warning,
  offline). Added self-contained CSS for the new heatmap tiles + file uploader so
  they don't depend on the precompiled scan; no change to the existing theme.
- Migrations `20260617140000/140100/140200`; security advisor clean (only by-design
  definer RPCs + N/A leaked-password).

## Phase 10 — Case Files → Google Drive integration built (2026-06-17)
Implemented the previously-stubbed Drive feature (design in
`docs/superpowers/specs/2026-06-15-case-files-drive-design.md`):
- `casefiles.js`: lazy-loads Google Identity Services + gapi Picker on first
  attach; OAuth token client scoped to `drive.file` (least privilege); attach via
  the Picker (multi-select) inserts `case_files` rows (`added_by = auth.uid()`);
  files render grouped into per-case folder cards with open links; director/command
  can remove; case-number combobox from `casesCache`; live via realtime
  subscription on `case_files`; search filter.
- `index.html`: `window.CID_GOOGLE` populated with the project's public OAuth web
  client ID, Picker API key, and GCP project number (all referrer/origin-restricted
  and public by design; allowlisted in `.gitleaks.toml`).
- Note: the static site has no build step, so these live in `index.html` directly
  (Vercel env vars are never substituted into the client).

## Phase 9 — Full logic audit & fixes (2026-06-17)
Meticulous audit of all 20 JS files (parse + cross-file scope + a 15-view runtime
smoke test) and the live DB schema. Bugs found and fixed:

- **🔴 Dead "Case Files" nav link.** The `case-files` tab (Google-Drive-per-case
  view) and `#view-case-files` section existed with two nav buttons, but the tab
  was missing from `PAGE_META`, so `navigate()` silently fell back to Command —
  clicking "Case Files" / "Files" opened the dashboard instead. Registered the
  tab + an `onEnterCaseFiles()` hook so the view opens (Drive integration itself
  shipped in Phase 10). *This was the reported "not working".*
- **🟡 Command "Open Cases" KPI count ≠ drill-down.** Card counted `open+active`
  but drilled to `open` only. Added an `open_active` filter token so the card's
  drill matches its count.
- **🟡 Command Persons KPIs stuck at 0 / empty detective filter on first land.**
  `renderKPIs` reads `PERSONS`/`PROFILES` but they were never reloaded/re-rendered
  on entering Command. `onEnterCommand` now reloads both and re-renders;
  `fetchProfiles` now repopulates the detective filter.
- **🟡 Denied case-access requests sent no notification** (deny button missing
  `data-req`, so `notify(undefined,…)`). Fixed.
- **🟢 Tracker code range** widened (`TRK-1000…9999`) to cut collisions.

DB (live project cid, migration `20260617130000_audit_security_hardening.sql`):
- Fixed `case_files.cf_delete` `USING (true)` → `private.can_delete()`.
- Revoked the `set_case_closed_at()` trigger function from the RPC surface.
- Security advisor now clean of actionable items.

Verified clean (no bug): all entity modules, the bureau/division access gate
(`division` stores bureau codes; admins get global access), and all collab inserts
(server-side `auth.uid()`/default columns).

## Phase 8 — Command dashboard cross-filter & drill-down (#17 follow-up)
Completes the part of #17 deferred in Phase 7. Central Command is now a true
supervisor cockpit:

- **Cross-filters:** a filter bar (visible only to `supervisor`, `bureau_lead`,
  `deputy_director`, `command`, `director`) scopes the whole dashboard by
  **bureau, lead detective, status** (incl. *awaiting sign-off* / *ready for DOJ*)
  **and a created-date range**. Every KPI, the bureau-load chart and the new
  drill-down all honour the active filter; a live "N of M cases" counter and a
  Reset control round it out.
- **Drill-down:** KPI cards (Open / Awaiting / Ready-DOJ / Cold) and the
  bureau-load bars are clickable — they set the matching filter and reveal a
  **Matching cases** panel that lists the scoped caseload; clicking a row jumps
  straight to that case file.
- **New KPIs:** **Avg Resolution** (mean open→closed time, backed by a new
  `cases.closed_at` column + trigger) plus seizures split into **money /
  narcotics / weapons** (the latter two derived from evidence type/description).
  Seizure & evidence KPIs re-scope to the filtered caseload when a filter is on.
- **Schema:** `20260617120000_cases_closed_at.sql` adds `cases.closed_at`,
  backfills existing closed cases, and auto-stamps/clears it via a status trigger.

## Phase 7 — Announcements depth, encouragement, KPIs, richer timeline
Continuation of the planned feature list (features #15 full spec, #16–18):

- **#15 Announcements (completed):** posts now carry **record links** (cases) and
  **@mentions** of individuals *or* rank groups ("@All Detectives", "@All Officers").
  Posting fires a **platform notification** to the audience (mentioned users get
  a "you were mentioned" reason). Officers can **dismiss** individual
  announcements (client-side hide via `Store`, not a delete; "show N dismissed"
  restores). Clicking an announcement opens a **full-view modal** with body +
  clickable linked records. Schema: `announcements.links` + `.mentions` jsonb.
- **#16 Encouragement widget:** non-intrusive rotating tactical phrase on the
  Central Command dashboard; rotates on load and every 5 min; dismissible for the
  session (returns on reload, per spec).
- **#17 Command KPIs:** added **Awaiting Sign-off** (cases stuck in the chain) and
  **Ready for DOJ** cards to Central Command, alongside the existing open/cold/
  persons/seizure KPIs, bureau load and audit activity feed. (Central Command is
  the command/supervisor dashboard; dedicated cross-filter/drill-down views remain
  a follow-up.)
- **#18 Case timeline (enriched):** the auto-generated timeline now merges
  **tracker logged/authorized**, **sign-off history**, and **chat messages** in
  addition to evidence collection, reports, custody transfers and case-opened.

## Phase 6 — Collaboration, access control & export
Checked each planned feature against the build; #1–7 already shipped in
Phase 5 and were skipped. Added the rest:

- **#8 In-case chat** (`collab.js`, `case_messages`): per-case channel with
  @mentions (→ notification) and record links (case chips open the case).
  Access gated to owner / same department / chain-lead roles / granted officers.
- **#9 Cross-case alert + access control** (`case_access_requests`,
  `case_access_grants`): the M.O. detector shows matches in inaccessible cases as
  a locked "flagged in another active investigation" alert (no detail leak) with
  a Request-access action. Owner/leads approve/deny in the Chat tab; the
  requester is notified and every request/decision is audited.
- **#13 Export/Import**: SheetJS added — the per-module import tool now accepts
  `.xlsx` (and `.xls`) alongside CSV/JSON; the Case Packet exports to **.docx /
  .pdf / .xlsx** via a chooser with an "Exporting… → Ready" flow, and the packet
  now bundles evidence + reports + media + RICO predicates. (PDF *import* is not
  implemented — reliable structured extraction from arbitrary PDFs isn't feasible
  client-side; CSV/XLSX/JSON cover bulk import.)
- **#14 Sidebar officer card**: removed the hardcoded "Det. Oliver Och / 915"
  block; now a live card (name, badge, department, CID rank, avatar, LOA badge,
  duty dot) that opens a My Profile editor (name/badge + self LOA toggle).
- **#15 Announcements**: new nav page + `announcements` table. Bureau Lead and
  above post (audience targeting + pin); all active officers read; unread badge.
- **#10/#12 polish**: `debounce()` util applied to case/person/gang filter
  inputs; tabs already lazy-fetch via onEnter*; fonts already use display=swap.

Schema: `20260616210000_chat_access_announcements.sql` (4 tables, 3 SECURITY
DEFINER helpers, RLS, audit + touch triggers, realtime) — applied live to cid.

Note on #9 secrecy: case rows remain readable platform-wide (dashboards, search,
KPIs depend on it); access grants gate the case *channel* and collaboration
surface. Hard row-level case hiding would require a visibility refactor across
every dashboard/search and is intentionally not flipped here.

## Phase 5 — Case sign-off workflow + LOA (Tom Wood / 934 workflow)
Verified first that none of the 7 requested features existed; all were added.
Also caught and fixed pre-existing split bugs found while wiring this in.

### Bugs fixed (pre-existing, from the monolith→multi-file split)
- **`casefiles.js` was never added to `index.html`** — so `DB()`, `dbReady()`,
  `casesCache`, `openCaseDetail`, and the entire `CIDApp.onAuthed` boot/fetch/
  subscribe routine were undefined. `auth.js` called `CIDApp.onAuthed` with
  nothing defining it: the authed app never loaded its data. Wired the script in.
- **`escapeHTML` used 120× across 9 files but never defined** (only `esc`
  existed). Added `const escapeHTML = esc;` alias in `core.js`. This had been
  breaking ballistics, gangs, persons, places, narcotics, cases, and trackers.

### Added — features (all were missing)
- **(1) LOA flag** — `profiles.loa` + `loa_since`. Self-toggle in the top bar
  (`auth.js`) and on the officer's own Personnel card; admins/Command/Director
  can set it via the Member Administration modal. Shown as an "On LOA" badge on
  roster cards and the admin table. LOA never blocks sign-off; it only steers
  routing.
- **(2) Sign-off submission UI** — new "Sign-Off" tab in Case Detail. Owners
  (Detective/Senior Detective) submit; reviewers Approve / Deny / Request
  changes (with notes). `signoff.js`.
- **(3) Auto-routing with LOA handling** — Detective → Bureau Lead → Deputy
  Director → Director. Skips a rank when its only members are on LOA / inactive,
  prefers the non-LOA officer when several share a rank (same-bureau Bureau Lead
  preferred), and escalates to the next rank when all are out. Director is final.
  Auto-escalation writes a history entry and an explaining notification. (Unit-
  tested across 7 scenarios.)
- **(4) Sign-off notifications** — `signoff_waiting`, `signoff_approved`,
  `signoff_denied`, `signoff_changes`, `signoff_escalated`, `signoff_heads_up`.
  Each carries case number, detective, reason, and `case_id`; the notifications
  panel now renders the reason and is click-through to the case. Deputy approval
  sends the Director a heads-up even when no action is required.
- **(5) Case status tracking** — `cases.signoff_status` (none → awaiting_bureau_
  lead → awaiting_deputy → approved_deputy → [approved_complete | awaiting_
  director → ready_doj], plus changes_requested / denied). Shown on case cards,
  the detail header, the overview, and a live chain-progress strip. Append-only
  `case_signoff_history` log (who/what/when, with notes). Realtime re-render of
  open Case Detail + history.
- **(6) Stop-point option** — after Deputy approval the owner chooses **Mark
  Approved & Complete** or **Escalate to Director**; the Director can still
  approve or send back if escalated.
- **(7) Ownership vs sign-off separation** — ownership stays on
  `cases.lead_detective_id` (owner selector in the case modal, gated to Bureau
  Lead / Deputy Director / Director / Command). Sign-off never changes ownership
  and ownership never auto-escalates; reassignment is explicit only.

### Schema / roles
- `supabase/migrations/20260616200000_case_signoff_loa.sql` — LOA columns,
  `cases` sign-off columns, append-only `case_signoff_history` (+RLS +realtime).
- Per Tom's choice, added dedicated chain roles to `app_role`:
  `senior_detective`, `bureau_lead`, `deputy_director` (non-breaking ADD VALUE;
  legacy `supervisor`→Bureau Lead and `command`→Deputy Director still honored by
  the router). Admin role picker updated with friendly labels.

## Phase 4 — Official SOPs/forms + Director as supreme role
### Added — CID General document library (live `documents` rows, fully editable)
- `supabase/migrations/20260616180000_sop_templates.sql` seeds the org-standard
  paperwork and reference material (idempotent upsert on the `(folder,name)` key):
  - **Forms/**: CID Investigative Report, Raid Seizure Value Distribution &
    Allocation Form, UC Operation Activity Report (blank, reusable templates).
  - **SOP/Training/**: CID Standard Operating Procedure (Titles 1–12) and the
    CID Case Building Playbook.
  - **Case assignment Help??!?/**: CID Case Assignment Procedure (7 steps).
  - **Resources/**: CID Roster (CID + FDU) and Gang Fact Sheet.
  - These are official org documents, not demo case data; they open as editable
    paperwork and export to .docx like any other Drive file.
  - Applied live to the `cid` Supabase project (all 8 documents verified present).

### Changed — Director is now the supreme role, above all ranks
- Per CID SOP Title 2A.1 ("the CID Director is the senior authority within the
  division"), Director gains full administrative authority equal-or-above Command.
- `supabase/migrations/20260616190000_director_supreme.sql`: redefines
  `private.is_command()` to accept `('director','command')`, so every gate that
  used it (the `profiles_command` policy, `assign_member`, the self-escalation
  block) now treats Director as a full administrator. Adds a `bootstrap_director`
  helper. `can_delete()` already included director. Applied live and verified.
- Client (`supabase.js`): added `isAdmin()` (director **or** command);
  `canDelete()` now delegates to it.
- Client (`app.js`): Member Administration panel now shows for Director or
  Command; role dropdown reordered so **director** reads as the top rank.

### Fixed
- Restored the split-shell `app.js` after a `main` merge had re-inlined the old
  monolith on top of the 16 feature files (duplicate init / double routing).

---

## Phase 1 — Backend foundation
Goal: stand up the Supabase backend that every module will migrate onto, with
real RBAC. No working front-end logic was rewritten in this phase.

### Added
- `supabase/migrations/20260616090000_platform.sql` — full platform schema:
  - **27 tables**: profiles, cases, case_assignments, persons, evidence,
    custody_chain (append-only), gangs, gang_ranks, gang_members, places,
    place_process_steps, narcotics, narcotic_precursors, narcotic_hotspots,
    ballistics_benches, ballistic_footprints, reports (with finalize +
    e-signature columns), trackers, rico_cases, predicate_acts, media,
    documents (server-side CID General docs), tickets, raid_compensations,
    mo_profiles, notifications, audit_log.
  - **Relational spine**: evidence/media/reports/trackers/hotspots/footprints/
    predicate_acts/gang_members all carry a `case_id` FK; predicate_acts link to
    `evidence`; gang_members link to `persons` + `cases`.
  - **RBAC RLS** (verified against Supabase docs):
    - `private` schema security-definer helpers (`is_active`, `role`,
      `can_delete`, `is_command`) with `search_path=''`.
    - Read = **approved members only** (inactive sign-ins see nothing).
    - Create/update = any active member; **delete = Director + Command**.
    - `profiles`: self-view + self-edit, with a guard trigger blocking
      role/active/division self-escalation; Command-only `assign_member` RPC.
    - Append-only `custody_chain` + `audit_log` (insert/select only).
    - Per-user `notifications`.
  - **Triggers**: `updated_at` touch on 18 tables; generic **audit** trigger on
    16 tables → `audit_log`; `handle_new_user` creates an inactive profile on
    OAuth signup; `bootstrap_command(email)` to seat the first admin.
  - **Realtime** publication on all 27 tables.
- `SETUP.md` — full deploy + Google/Discord OAuth + migration + bootstrap + RBAC.

### Verified
- Migration applies cleanly on Postgres 17 (27 tables, 102 policies, 27 realtime,
  16 audit triggers).
- RBAC behavior tested as the `authenticated` role: inactive → 0 reads;
  activated detective → create+read; detective delete → 0 rows (denied);
  Director delete → success; audit_log captured insert+delete.

### Fixed (bugs caught while building)
- `default (select auth.uid())` → `default auth.uid()` (subqueries are not
  allowed in column DEFAULTs; the `(select …)` form is only for RLS perf).
- `private` schema was revoked from `authenticated`, which would break every RLS
  policy (policy expressions run as the caller); now grants USAGE + EXECUTE on
  the helpers to `authenticated`.

## Pending phases (planned, not yet built)
- **Phase 2 — Front-end:** multi-file split (`index.html` + `styles` + feature
  JS modules + `supabase.js`/`auth.js`); **login gate** (Google + Discord),
  logged-out users see only the login screen; migrate every module's data layer
  from `localStorage` to Supabase with realtime; first-class **Evidence** module
  + **Case Detail** view (Overview/Evidence/Reports/Media/Suspects/Gangs/RICO/
    Timeline/Trackers/Chain-of-Custody) + auto timeline; **RBAC-aware** edit
  affordances; **remove all seed data** → empty states + CSV/JSON import;
  notifications panel; analytics from `audit_log`; PDF export; full case-packet
  export. Blocked on: Google + Discord OAuth credentials + authorization to
  resume/apply against the live project.

### Data migration note (localStorage → Supabase)
The current single-file app stores everything under `localStorage` key
`cid-portal-v3` (cases, gangs, places, reports, rico, trackers, media, cidDocs,
caseCounters). Phase 2 ships a one-time importer to load any existing browser
data into the new tables via the UI; nothing is baked into source.

## Phase 2 — Front-end foundation
Target project corrected to **`cid`** (`jhxuflzmqspidkvjckox`, active); `sahp-rbac` was the wrong project.

### Added / changed
- **Multi-file split** (no build step, still a static SPA):
  - `index.html` — markup only.
  - `styles.css` — the precompiled Tailwind + custom CSS (was inlined) + gate CSS.
  - `app.js` — the existing application logic, moved verbatim (not rewritten).
  - `supabase.js` — Supabase client + thin data layer (`window.CIDDB`): auth
    helpers + generic list/insert/update/remove/subscribe. Guarded if unconfigured.
  - `auth.js` — **login gate**: logged-out users see only the login screen
    (Google + Discord OAuth + email magic link); signed-in-but-unapproved users
    see a pending-approval screen; approved (active profile) users get the app +
    an identity/sign-out chip in the top bar. Drives `body[data-auth]`.
- Front-end config wired to the real `cid` project URL + publishable key.

### Verified (jsdom, offline)
Split loads; gate shows by default with the graceful offline notice; app shell
hidden when logged out; `app.js` still initializes; records nav intact.

### Still pending in Phase 2 (blocked / next)
- **Schema reconciliation**: the `cid` project already has `cid_records` (2 rows)
  + `case_files` (0 rows), which diverge from the Phase-1 platform schema
  (`cases`, `evidence`, …). Need a decision before applying the platform
  migration / migrating module data layers.
- Apply the platform migration (creates `profiles` — required for auth approval
  to actually work) once schema is reconciled.
- Configure Google + Discord providers in the dashboard to test real sign-in.
- Then: per-module localStorage→Supabase data layer, Case Detail + Evidence UI,
  RBAC-aware edit affordances, notifications, analytics, PDF, seed removal.

### Applied to the live `cid` project
- Applied `20260616090000_platform.sql` to project `cid` (jhxuflzmqspidkvjckox):
  27 platform tables created with RLS, alongside the pre-existing `cid_records`
  (2 rows) + `case_files` — no collisions, no data loss.
- Ran the Supabase **security advisor**; fixed a real finding: `bootstrap_command`
  (SECURITY DEFINER, no internal guard) was REST-callable by anon/authenticated —
  a self-promotion-to-Command hole. Revoked execute from anon/authenticated/public
  (SQL-editor only). Trimmed `assign_member` from anon (still callable by
  authenticated Command users; internally guarded).
- Remaining advisor notes (not addressed here): `case_files.cf_delete USING(true)`
  is a pre-existing user table (left untouched); leaked-password protection is an
  auth setting irrelevant to our OAuth + magic-link flow.

### To make auth functional (your dashboard steps)
1. Authentication → Providers: enable **Google** + **Discord** (creds + the
   `https://jhxuflzmqspidkvjckox.supabase.co/auth/v1/callback` redirect).
2. Authentication → URL Configuration: set Site URL + Redirect URLs to your Pages URL.
3. Sign in once, then SQL editor: `select public.bootstrap_command('<your-login-email>');`

## Phase 2 — Module migration #1: Case Files
First module migrated off localStorage onto the live Supabase schema (project `cid`).

### Added
- **Case Files tab** (sidebar + mobile bar) — Supabase-backed, RBAC-aware, realtime.
  - List of cases (cards) from `public.cases`, filter + refresh, empty/“create first” states.
  - Create/Edit case modal (case_number/title/bureau/status/summary) → `CIDDB` insert/update.
  - **Case Detail** view with tabs: Overview, Evidence, Reports, Timeline.
  - **Evidence** module: add evidence per case; **chain-of-custody** append-only transfer log.
  - **Timeline**: merges case-open + evidence collection + report + custody-transfer events.
  - RBAC affordances: create/edit shown to active members (`CIDDB.canEdit`); **delete** only
    for Director/Command (`CIDDB.canDelete`); realtime re-fetch via `CIDDB.subscribe('cases')`.
- `supabase.js`: added `me`/`role()`/`canEdit()`/`canDelete()`; `auth.js` caches the
  profile + calls `CIDApp.onAuthed()` so modules load once a session is approved.

### Verified
- All JS passes `node --check`; jsdom load is clean (no window errors; gate works; Cases
  tab shows its sign-in notice offline).
- **Live schema round-trip via MCP** on project `cid`: inserted case→evidence→custody,
  confirmed FK cascade on delete and that audit triggers fired (audit_log += 3); test rows
  removed (0 leftover).
- Hardened: guarded `history.replaceState` so restricted/file:// contexts can't break routing.

### Next modules (same pattern)
persons/suspects, gangs (+members→persons), places, narcotics/ballistics hotspot+footprint
links, reports (finalize + e-sign + PDF), trackers (server-side + notify), RICO (pull
predicates from evidence), audit-log feed + analytics on Central Command, seed removal +
CSV/JSON import, full case-packet export.

## Phase 2 — Module migration #2: Persons + Gangs
- Added `gang_turf` table + free-text `gang_members.rank` (migration
  `20260616093000_gang_turf_member_rank.sql`; applied to project `cid`).
- **Persons** (new tab, Supabase): suspects/POI CRUD with gang link, CCW/VCH/
  felony fields (≥8 flag), mugshot, notes; filter + realtime; delete gated to
  Director/Command.
- **Gangs** migrated OFF localStorage onto Supabase: list + record CRUD, and a
  **Gang Detail** with rank-grouped **member** sub-CRUD (members link to a
  Person and a Case), **turf** sub-CRUD, and read-only **linked properties**
  (places whose controlling_gang = this gang). `GANGS` is now a Supabase read
  cache feeding the place/media/RICO gang pickers.
- Fixed RICO references that used the old localStorage gang shape
  (`.members`/`.threat`) → now use `threat_level`.
- Verified: node --check; clean jsdom load (both tabs, proper sign-in notices,
  no errors); live MCP round-trip on `cid` (gang→person→member(person+case)→turf
  insert with full FK chain; cascade-clean delete).

## Phase 2 — Module migration #3: Narcotics
- **Narcotics** migrated off localStorage onto Supabase (narcotics + precursors +
  hotspots). `DRUGS` is now a normalized read cache; the expandable registry,
  purity-slider→adjusted-value calc, pricing/popularity bars and case-linked
  hotspots are preserved (logic unchanged, data live).
- CRUD: "+ New Narcotic" + per-drug Edit modal (fields + precursor rows + hotspot
  rows with density + case link); children replaced on save; delete gated to
  Director/Command. Empty/sign-in states; realtime; recompute guards zero precursors.
- Places' production-recipe + drug picker read the DRUGS cache (Places remains
  localStorage for now; links by name).
- Verified: node --check; clean jsdom load (sign-in notice, no errors); live MCP
  round-trip on `cid` (narcotic→precursor→hotspot insert; cascade-clean delete).

## Phase 2 — Module migration #4: Criminal Places
- **Places** migrated off localStorage onto Supabase (`places`). FK links to live
  gangs (controlling_gang_id), cases (case_id), and **narcotics** (narcotic_id).
- Drug-lab locations show an auto production process derived from the linked
  narcotic's precursors/hotspots (cross-referencing the live Narcotics module).
- CRUD with RBAC (create/edit active; delete Director/Command), empty/sign-in
  states, realtime. PLACES is now a Supabase cache; Gang Detail's "linked
  properties" reads live places.
- Verified: node --check; clean jsdom load; live MCP round-trip on `cid`
  (place linked to gang+case+narcotic) with cleanup.

## Phase 2 — Module migration #5: Ballistics
- **Ballistics** migrated off localStorage onto Supabase: `ballistics_benches`
  (street/organized toggle, tier, heat, outputs[]/components[] text arrays,
  case link) and `ballistic_footprints` (signature, weapon, gang link, case link).
- CRUD: "+ Bench" / "+ Footprint" + per-item Edit; RBAC (active create/edit,
  Director/Command delete); empty/sign-in states; realtime.
- Verified: node --check; clean jsdom load; live MCP round-trip on `cid`
  (bench with text[] arrays + footprint linked to gang+case) with cleanup.

## Phase 2 — Module migration #6: Reports
- **Reports** migrated off localStorage onto Supabase (`reports`): per-case
  chains (Initial → Supplemental #N → Follow-up #N), server-persisted with
  jsonb fields; seq computed server-side; case dropdown + RICO select now source
  live cases (uuid value, case_number label) and refresh after cases load.
- **Finalize + e-signature**: lock-on-finalize sets `finalized` + `signature`
  (officer + badge + timestamp); finalized reports show a signature block and the
  lock badge.
- **PDF export** via jsPDF (CDN, graceful offline fallback) alongside the existing
  dependency-free .docx writer; both include the signature block; Print preserved.
- autoVal now resolves case_number/bureau/detective from live caches.
- Verified: node --check; clean jsdom load (5 templates, sign-in notice, no
  errors); live MCP round-trip on `cid` (report insert with jsonb fields +
  finalize/signature update) with cascade-clean delete.

## Phase 2 — Module migration #7: Trackers
- **Trackers** migrated off localStorage onto Supabase (`trackers`): deploy
  (command/director signs as Director → status pending), **co-sign** by a second
  command officer (sets deputy_sig + status authorized + expires_at = now +
  duration) — enforces no single-person approval. Live per-second countdown from
  expires_at; **auto-expire** flips status to 'expired' (audit-logged).
- **Notifications**: rows written to `notifications` for the signatories on
  deploy + authorization (surface in the notifications panel — next).
- Signer names resolved via a `profiles` cache (`officerName`). RBAC: deploy/
  co-sign/delete gated to Director/Command; read-only otherwise.
- Case picker sources live cases. Verified: node --check; clean jsdom load
  (sign-in notice, no errors); live MCP round-trip on `cid` (deploy pending →
  authorize + 18h expiry window) with cleanup.

## Phase 2 — Module migration #8: RICO
- **RICO** migrated off localStorage onto Supabase (`rico_cases` + `predicate_acts`,
  one rico_case per case, created lazily on first action).
- Predicates can **link to a case's evidence row** (`evidence_id` dropdown of the
  case's evidence) or a free-text `evidence_ref`; keeps ≥2-within-10-years
  validation + live readiness meter (red/amber/green).
- RBAC: enterprise link + add predicate = active members; predicate delete =
  Director/Command. Predicate Summary .docx export now reads live data.
- RICO case select sources live cases (uuid). Verified: node --check; clean jsdom
  load (sign-in notice, no errors); live MCP round-trip on `cid`
  (rico_case + enterprise + 2 predicates: one evidence-linked, one ref) with
  cascade-clean delete.

## Phase 2 — Central Command live + Admin + Notifications + Packet + Search
- **CRITICAL FIX:** `index.html` was still running the **stale pre-split monolith
  inline** and never loaded the external modules — so all prior Phase 2 work was
  orphaned. Replaced the inline `<script>` with `<script src>` for
  `supabase.js` → `app.js` → `auth.js`. The platform is now actually wired.
- **Central Command (live):** KPIs (open/cold cases, persons, total seizures from
  raid_compensations), Odyssey ticket queue from `tickets` + "+ New Ticket";
  **Process Ticket wizard now creates a real `cases` row** and marks the ticket
  processed (with the misroute auto-rename retained); activity feed from
  `audit_log`; bureau caseload computed from live cases.
- **Member administration (Command):** in Personnel, list `profiles` and
  approve/assign role + bureau + active via the `assign_member` RPC — the first
  in-app way to approve members (previously SQL-only).
- **Notifications:** top-bar bell + unread badge + panel (mark-all-read); tracker
  deploy/co-sign already write rows.
- **Case-packet export:** Case Detail → one `.docx` bundling summary + evidence +
  reports + RICO.
- **Global search:** top-bar search now queries Supabase across cases/persons/
  gangs/places (ilike) with a results modal; case hits jump to Case Detail.
- Removed dead dashboard seed consts (KPIS/TICKETS/ACTIVITY/BUREAU_LOAD).
- `supabase.js`: added `rpc()`. Verified: all JS `node --check`; jsdom load
  exercises external modules — 13/13 tabs activate, CIDDB + CIDApp present, gate
  works, no errors.

### Still localStorage (final remaining sliver)
Personnel roster/commendations, the media/evidence vault, the M.O. detector, and
the CID General documents are still client-side; plus a per-module CSV/JSON
importer and their seed removal. These are the last items to migrate.

## Phase 2 — Module migration #9: Personnel, Commendations, Media, M.O.
- **Personnel roster** now renders from `profiles` (live), not a seed array.
- **Commendations** → Supabase `commendations` table (new migration) with full
  CRUD, edit/delete gating, and realtime.
- **Evidence/media vault** → `media` table: ingest modal writes rows, "forward to
  case" updates `case_id`, tag chips resolve case/gang by id; realtime.
- **M.O. detector** cross-references live `mo_profiles` (per-case indicators);
  "Save as Case Profile" persists a scan; matching jumps off real cases.

## Phase 2 — Module migration #10: CID General "Drive"
- Folders are now presentation config (`FOLDER_META`); every file is a row in the
  `documents` table. Docs/sheets are editable & shared (realtime); pdf/zip
  read-only; CI Risk Matrix stays a live computed read-only view.
- Editors get "+ New Document" and per-folder import; command/director can delete.

## Phase 3 — Seed removal, bulk import, file split, auth fixes
### Removed
- **All baked-in demo content.** Domain tables ship empty with "create first" CTAs.
  The CID Drive's 26 seeded templates were deleted (live) and the seed migration
  reduced to a `(folder,name)` unique constraint — the Drive now starts empty.
- Dead `ACTIVE_CASES` constant and the localStorage `caseCounters` sequence; case
  numbers are now derived from existing `cases` (`nextCaseNumber`).
### Added
- **CSV/JSON bulk import per module** (`core.js`): paste a JSON array or CSV (or
  upload a file), allow-listed columns + type coercion, batch insert via Supabase
  (RLS applies), inserted/skipped reporting. "Import" button beside each module's
  "+ New" action (cases, persons, gangs, narcotics, places, ballistics
  benches/footprints, trackers, tickets, commendations, media) and per-folder in
  the Drive.
### Changed
- **Front-end split into 16 feature files** (`core, command, narcotics, ballistics,
  personnel, modus, drive, persons, gangs, places, reports, rico, docx, records,
  casefiles, app`) — classic scripts sharing one global lexical scope, no build
  step. Byte-for-byte contiguous slice of the former monolith (verified), loaded
  in order before `auth.js`.
- Added `AGENTS.md` — codebase orientation and audit notes.
### Fixed
- **Login blocker:** users created before the profiles trigger existed had no
  `profiles` row (stuck on "pending approval"). Backfilled profiles for all
  pre-existing `auth.users`; seated the owner as Command. New sign-ins already get
  a profile via the `handle_new_user` trigger (verified Google + Discord both work).
