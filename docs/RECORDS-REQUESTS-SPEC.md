# Records & Requests — Decision Log + Gap Analysis

**Status:** design captured, not yet implemented
**Scope:** the "requests" domain — subpoenas, warrants, social-media/account
requests, records returns, MDT projection, classification, notifications,
retention. Covers requirements **Batches 8–14** from the owner Q&A.

> **Headline finding.** Most of what these batches specified **already exists**
> in the `legal_requests` domain (`src/lib/legalWorkflow.ts`, `src/lib/justice.ts`,
> the `legal_requests` table + satellites, and the `mdt_wanted_projections`
> projection). This document records each decision, marks whether it is **already
> built**, **partial**, or a **genuine delta**, and proposes a scoped plan for the
> deltas only. It deliberately does **not** re-build what stands.

---

## 0. What already exists (baseline)

| Capability | Where |
|---|---|
| Warrant + subpoena request types, subtypes, per-subtype form fields | `justice.ts` `WARRANT_TYPES`, `SUBPOENA_TYPES`, `WARRANT_FIELDS`, `SUBPOENA_FIELDS` |
| `social_media_accounts` subpoena subtype (platform, username, requested content, date range) | `justice.ts:117`; in-RP platforms `SOCIAL_PLATFORMS = ['Birdy','InstaPic']` |
| Full lifecycle: draft → CID review → DOJ intake → prosecutorial → judicial → issued → fulfilment → closed | `legalWorkflow.ts` stage model |
| Service / execution / return recording (served/executed/return-filed, outcomes, notes, methods, compliance) | `legalWorkflow.ts` `fulfilmentEvents`, `legal_requests` columns |
| Classification tiers `standard \| restricted \| classified \| sealed` | `legal_requests.classification`; sealed hides existence |
| MDT wanted projection w/ caution warning + **sealed-skip until executed** | `mdt_wanted_projections`, `private.mdt_project()` (`20260807080000_mdt_sealed_skip.sql`) |
| Deadlines + urgency (response_deadline, expires_at, overdue/soon) | `legalWorkflow.ts` `activeDeadline`, `urgencyFor` |
| Versions, per-action audit, exhibits, participants, signatures | `legal_request_versions/_actions/_exhibits/_participants/_signatures` |
| Tombstone soft-delete + 5-min-sudo owner permanent delete | Phase B deletion model |
| Discord notify edge function | `supabase/functions/discord-notify/index.ts` |

---

## 1. Decision log (Batches 8–14)

Legend: ✅ already built · 🟡 partial (extend) · 🟥 genuine delta (net-new)

### Batch 8 — Social-media & accounts
| # | Decision | State |
|---|---|---|
| 8.1 | Detectives may preserve **public + voluntarily-shown** content, stored as Media/Intel referencing the account | 🟡 media exists; account reference is delta |
| 8.2 | Returns **auto-create Intelligence-Review items + duplicate checks** (match returned phones/plates/accounts vs registries) | 🟥 |
| 8.3 | Accounts are **CID-only**; nothing reaches the in-city MDT unless explicitly exported | ✅ (MDT projection is warrant-only, opt-in) |
| 8.4 | Account→person ownership **auto-upgrades to Confirmed** from a supporting return | 🟥 |
| 8.5 | Request record categories: subscriber+history, logins+metadata, content+media+deleted, transactions+admin — **all supported** | 🟡 subtype exists; category granularity is delta |
| 8.6 | **Full account identity handling**: case-insensitive username match, username-history trail, separate immutable account ID, normalized profile URLs | 🟥 |
| 8.7 | Accounts appear in the **relationship Graph** | 🟥 |
| 8.8 | Returned **message content is more restricted** than subscriber data | 🟡 `classification` exists; per-return default is delta |

> **Batch 8 is the largest delta.** Today `social_media_accounts` is a *free-text
> subpoena subtype*. The decisions describe a first-class **Account registry
> entity** — persistent, person-linked, confidence-scored, Graph-visible, with
> immutable IDs and username history. That entity does not exist yet.

### Batch 9 — Records-return workflow
| # | Decision | State |
|---|---|---|
| 9.1 | Assigned detective records **service** (attempted/served/failed, date+method) | ✅ |
| 9.2 | Returns accepted via **all channels**: portal upload, manual entry, external link, in-game/Discord reference | 🟡 upload+manual exist; link/reference metadata is delta |
| 9.3 | Attachments in **all formats**: PDF, image, text, structured data | 🟡 (structured-data return parsing is delta) |
| 9.4 | **Simple statuses, manual close** (awaiting → received; person closes) | ✅ |
| 9.5 | Detective extracts facts; confirmed identifiers added directly; **sensitive/new-suspect facts flagged for Lead+** | 🟥 (extraction workflow) |
| 9.6 | Returns are **editable** (not locked) | ✅ |
| 9.7 | Capture custodian/org, received date + certification, limitations/objections, completeness | 🟡 narrative exists; structured metadata fields are delta |
| 9.8 | Deadlines in Calendar + Action Center; overdue notifies detective **and** Lead+ | ✅ (Calendar + Action Center already consume `activeDeadline`) |

### Batch 10 — Warrant execution
| # | Decision | State |
|---|---|---|
| 10.1 | Arrest = patrol or CID; search = CID-led | ✅ (policy) |
| 10.2 | City flow: on approval the accepting party **uploads the warrant to the in-city MDT for all officers → contact CID command**; CID directs execution | ✅ MDT projection exists; broadcast semantics ✅ |
| 10.3 | Support **partial** execution + **"unable to execute"** (reason required) | 🟡 `execution_outcome` free-text exists; typed partial/unable is delta |
| 10.4 | Executing a warrant **auto-generates a report draft** | 🟥 |
| 10.5 | Capture officers+date/time, target+incident number, seized+arrest, conditions+notes — **no injuries field** | 🟡 (incident number, structured seized are delta) |
| 10.6 | Seized items recorded **both** as quick text now + **structured inventory** later | 🟥 (structured seized-items inventory) |
| 10.7 | Detective **files and closes** the return (no Lead+ acceptance step) | ✅ |
| 10.8 | Corrections are **versioned with a required reason** | ✅ |

### Batch 11 — In-city MDT
| # | Decision | State |
|---|---|---|
| 11.1 | Exports: wanted/BOLO persons, vehicle BOLOs, caution flags, approved warrants — **never case details** | 🟡 warrant projection ✅; person/vehicle BOLO + caution channels are delta |
| 11.2 | **Lead+ only** may export | 🟡 (projection is automatic on issue; explicit Lead+ export gate is delta) |
| 11.3 | Patrol sees **minimal safety-relevant** fields only | ✅ (projection is name/warrant-ref/caution only) |
| 11.4 | Patrol action on an exported item **auto-feeds back** to the linked case | 🟥 |
| 11.5 | Alerts stay until **manually cleared** (no auto-expiry) | 🟡 (`sync_status` exists; manual-clear UX is delta) |
| 11.6 | Caution flags: **CID proposes, Lead+ approves** | 🟥 |
| 11.7 | **Case existence always hidden** from patrol | ✅ |
| 11.8 | **Full export audit** (export/edit/clear, who/when/fields) | 🟡 (extend audit to projection events) |

### Batch 12 — Notifications & escalation
| # | Decision | State |
|---|---|---|
| 12.1 | Detective notified on **response-uploaded + status changes** | 🟡 |
| 12.2 | Lead+ notified on **exceptions only** (overdue, refused/objected, sensitivity-flag) | 🟡 |
| 12.3 | **Per-type default deadlines**, editable per request | 🟡 (deadlines exist; per-type defaults are delta) |
| 12.4 | Overdue **raises Action Center priority + notifies Lead+** | 🟡 |
| 12.5 | All open requests appear as **Action Center items** | ✅ |
| 12.6 | Channels: in-app for all + **Discord ping for high-priority/overdue** | 🟥 (wire request events → `discord-notify`) |
| 12.7 | **Daily command digest** of aging/overdue requests for Lead+ | 🟥 |
| 12.8 | Deadline **clock pauses** while refused/awaiting-legal | 🟥 |

### Batch 13 — Classification & access
| # | Decision | State |
|---|---|---|
| 13.1 | **Two tiers** conceptually (Standard / Restricted) for request data | ✅ (`classification` already has these + more) |
| 13.2 | Restricted returns visible to **assigned members + Lead+** | ✅ (RLS) |
| 13.3 | Classification **auto-defaults by category**, Lead+ override | 🟡 (`legal_default_classification` exists; per-return-category default is delta) |
| 13.4 | **Restricted views separately audited** (who/when) | 🟥 |
| 13.5 | Extractions **inherit Restricted until reviewed** | 🟥 |
| 13.6 | Non-cleared members see a **locked row** (item exists, contents hidden) | 🟡 |
| 13.7 | Restricted items need **Lead+ approval to enter a packet/export** | 🟥 |
| 13.8 | **Break-glass** with mandatory reason + Lead+ notified + audited | 🟥 |

### Batch 14 — Retention, hold & purge
| # | Decision | State |
|---|---|---|
| 14.1 | **Same tombstone model** for request records | ✅ |
| 14.2 | **Lead+ legal hold** blocks purge until lifted | 🟥 |
| 14.3 | Requests **retained with parent case** (no independent auto-purge) | ✅ |
| 14.4 | Case purge **cascades a tombstone** but **preserves the audit trail** | 🟡 (verify cascade covers legal satellites) |
| 14.5 | Audit covers create+service, response+extraction, classification+views, export+purge | 🟡 (extend to views/exports) |
| 14.6 | Audit trail is **append-only / immutable** | ✅ (`legal_request_actions` is insert-only) |
| 14.7 | Only **Owner-under-sudo** may hard-purge | ✅ |
| 14.8 | **Active legal hold cannot be overridden, even by Owner** | 🟥 (depends on 14.2) |

---

## 2. Genuine deltas (the only net-new work)

Grouped for implementation. Everything else above is already built or a small
field/wiring extension.

**D1 — Account registry entity (Batch 8).** New `accounts` table (immutable
platform+external_id, normalized handle, username-history, person links with
`ownership_confidence` + `confirmed` flag), Graph node kind, RLS (CID-only),
registry + dossier UI, and cross-reference/dup-check against returned
identifiers. *Largest item.*

**D2 — Return extraction + intel feedback (Batches 8/9).** On a recorded
return: parse/echo structured identifiers, run duplicate checks vs
persons/vehicles/accounts, auto-create Intelligence-Review items, and
auto-upgrade account ownership to Confirmed when a return supports it.
Sensitive/new-suspect facts flagged for Lead+.

**D3 — Structured seized-items inventory + typed execution outcome (Batch 10).**
Typed `partial | unable` outcome (reason required) and a structured seized-items
inventory (item, qty, category, links to evidence/persons/vehicles) alongside the
existing free-text. Optional auto-report-draft on execution.

**D4 — MDT export controls & feedback (Batch 11).** Lead+-gated explicit export
for person/vehicle BOLOs + caution flags (CID-proposes/Lead+-approves), manual
clear UX, patrol-action feedback item onto the case, and projection-event audit.

**D5 — Notification routing (Batch 12).** Wire request events to `discord-notify`
for high-priority/overdue; per-type default deadlines; overdue priority-raise;
deadline-clock pause on blocked states; daily Lead+ command digest.

**D6 — Restricted handling hardening (Batch 13).** Per-view audit of Restricted
returns, classification inheritance on extractions, locked-row rendering for
non-cleared, Lead+ approval to include Restricted in exports, and a break-glass
flow (reason + Lead+ notify + audit).

**D7 — Legal hold (Batch 14).** A hold that blocks purge on a case/request until
a Lead+ lifts it; Owner cannot override an active hold; wire into the existing
purge RPCs and cascade.

---

## 3. Suggested sequencing

1. **D7 legal hold** + **D3 execution/inventory** — small, self-contained, high
   value, no new entity.
2. **D5 notifications** + **D6 restricted hardening** — mostly wiring onto
   existing columns/functions.
3. **D4 MDT export controls** — extends the existing projection.
4. **D1 account registry** + **D2 extraction/feedback** — the big net-new build;
   D2 depends on D1's entity.

Each lands as its own migration (`vNNN`), snapshot + `database.types` mirror,
RLS tests, and gates — matching the established workflow.

---

*This document is the source of truth for the requests-domain decisions. Earlier
batches (1–7) were captured in prior sessions and are out of scope here.*
