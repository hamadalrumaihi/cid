# MDT Bridge Contract (CID Portal → FiveM)

**Status: forward-looking. No consumer is deployed.** The only implemented
piece is the read surface `public.mdt_patrol_feed()` (migration
`20260808280000_mdt_bridge_expansion`). Everything else in this document
describes how a future FiveM-side sync service is expected to consume it. The
feature ships in code but is **not active on the site**: the feed is
unreachable from the app runtime (see [Authentication](#authentication)), and
the new export kinds are inert until a user invokes the existing
propose/approve RPCs.

## The read surface

```sql
public.mdt_patrol_feed()
returns table (
  export_id     uuid,         -- stable row id (mdt_exports.id or mdt_wanted_projections.id)
  kind          text,         -- see the per-kind table below
  subject       text,         -- snapshot TEXT only — never a portal entity id
  wanted_status text,
  risk_level    text,         -- null / low / medium / high / critical
  instructions  text,
  status        text,         -- always 'exported' in the feed
  expires_at    timestamptz,  -- reminder only; see Expiry semantics
  updated_at    timestamptz
)
```

`LANGUAGE sql STABLE SECURITY DEFINER, set search_path = ''`. Two row sources,
unioned into the one shape:

1. **The export outbox** — `public.mdt_exports` where `status = 'exported'`
   **and** `patrol_visible` **and** `kind <> 'account'`.
2. **The automatic arrest-warrant projection** — `public.mdt_wanted_projections`
   where `wanted_status = 'wanted'`, mapped to `kind = 'arrest_warrant'`,
   `subject = person_name_snapshot`,
   `instructions = classification_safe_warning`, `status = 'exported'`,
   `risk_level = null`. This path is populated automatically by
   `private.mdt_project` from issued arrest warrants (search warrants and
   sealed-unexecuted warrants never project) and is not writable through the
   export RPCs.

### The allowlist is structural

The nine columns above are the **entire** bridge payload. The feed selects
only them, so the following can never cross, by construction rather than by
filtering: `source_case_id` (the patrol MDT must never learn a CID case
exists — Batch-11 decision 11.7), `reason`, `proposed_by` / `exported_by` /
`cleared_by`, and the raw `person_id` / `vehicle_id` / `account_id` FKs.
`subject` is the human-readable snapshot text captured at propose time.

## Per-kind field allowlist

All kinds share the same nine-column shape; per kind, the fields that are
expected to be populated:

| kind | lane | subject holds | wanted_status | risk_level | instructions | expires_at |
|---|---|---|---|---|---|---|
| `person_bolo` | patrol | person snapshot label | optional | optional | optional | optional |
| `vehicle_bolo` | patrol | vehicle/plate snapshot label | optional | optional | optional | optional |
| `caution` | patrol | person snapshot label | rarely | expected | expected (officer-safety text) | optional |
| `arrest_warrant` (manual push) | patrol | person snapshot label | expected | optional | optional | optional |
| `arrest_warrant` (auto projection) | patrol | `person_name_snapshot` | always `'wanted'` | always null | `classification_safe_warning` | warrant expiry |
| `person_record` | patrol | person snapshot label | rarely | optional | optional | optional |
| `vehicle_record` | patrol | vehicle snapshot label | rarely | optional | optional | optional |
| `account` | **CID-only — never in the feed** | — | — | — | — | — |

Notes:

- `person_record` / `vehicle_record` are plain informational patrol records,
  **not** BOLOs — consumers should render them without alerting.
- A **manual** `arrest_warrant` export and the **automatic** projection are
  separate rows from separate sources; if CID manually pushes a warrant that
  is also projected, the consumer may see both (distinct `export_id`s) and
  should de-duplicate on display if needed.
- `subject` on the auto-projection branch is nullable in principle
  (`person_name_snapshot` is a nullable column); treat `subject` as optional.

## Lanes: patrol vs CID-only

`mdt_exports.patrol_visible` is the lane switch:

- `patrol_visible = true` (default) — the row is eligible for the patrol feed
  once exported.
- `patrol_visible = false` — CID-only: visible inside the portal (members
  read `mdt_exports` under RLS) but never crosses the bridge.

`kind = 'account'` is **structurally CID-only**: the
`mdt_exports_account_cid_only` CHECK (`kind <> 'account' OR patrol_visible =
false`) makes an account export incapable of being patrol-visible, the
propose RPC forces `patrol_visible = false` for accounts regardless of the
parameter, and there is no client write policy on `mdt_exports` that could
flip it. Account intelligence never reaches the in-city MDT.

## Lifecycle

`proposed → exported → cleared`, server-authoritative via three SECURITY
DEFINER RPCs (there are no client write policies on `mdt_exports`):

1. `mdt_export_propose(...)` — any **active CID member**. Validates the
   kind/target pairing, snapshots the subject label, forces the account lane.
2. `mdt_export_approve(p_export)` — **Lead+ (command)** only, and **not the
   proposer** (self-approval is prohibited; the RPC rejects
   `proposed_by = auth.uid()`). Sets `status='exported'`, stamps
   `exported_by/at`, resets `sync_status='pending'`.
3. `mdt_export_clear(p_export, p_reason)` — **Lead+** only, manual. Sets
   `status='cleared'`, stamps `cleared_by/at` + reason, resets
   `sync_status='pending'`.

Only `exported` rows appear in the feed. `cleared` rows leave the feed and
free the "one live export per subject" partial-unique slots (person+kind /
vehicle / account). Everything is audited (`MDT_EXPORT_PROPOSED` /
`_APPROVED` / `_CLEARED`).

Uniqueness discipline: one live (non-cleared) export per `(person_id, kind)`,
per `vehicle_id` (kind-wide — a vehicle holds one live export across
`vehicle_bolo`/`vehicle_record`; clear before re-proposing the other kind),
and per `account_id`.

## sync_status semantics

`mdt_exports.sync_status` (default `'pending'`, reset to `'pending'` on
approve and clear) is currently a **write-only marker** — nothing consumes or
advances it. A future bridge worker is expected to poll `mdt_patrol_feed()`,
apply the delta in-city, and (via a future server-side RPC or service-role
update — not yet defined) advance `sync_status` to a synced/failed state.
Until that exists, do not build logic on `sync_status`; treat the feed as the
authoritative current state and diff against it. The same applies to the
richer sync bookkeeping on `mdt_wanted_projections`
(`sync_attempts` / `last_sync_at` / `last_sync_error`).

## Expiry semantics

`expires_at` is a **reminder, not an expiry**. There is no auto-clear, no
cron: an export past its `expires_at` continues to flow in the feed until a
Lead+ manually clears it (Batch-11 decision 11.5). Consumers may badge or
surface overdue rows; they must not hide them. The portal will later use it
for reminder surfacing. (The auto-projection branch carries the warrant's own
expiry; the portal-side `mdt_wanted_current()` computes an `'expired'`
display status for members, but the feed row persists per the same manual
discipline.)

## Authentication

- `mdt_patrol_feed()` is EXECUTE-granted to **`service_role` only**. It is
  revoked from `public`, `anon` **and** `authenticated` — the portal frontend
  and every logged-in member are locked out at the grant level. This is the
  dormancy guarantee for the "ships in code, not active on the site"
  requirement, and it is asserted by the v157 RLS suite.
- The future consumer is a **server-side** FiveM bridge service holding the
  Supabase `service_role` key. That key is a server secret: never shipped to
  a game client, a browser, or the portal runtime; never embedded in a client
  resource. The bridge service is the only holder, and it should call the
  feed over HTTPS via PostgREST (`POST /rest/v1/rpc/mdt_patrol_feed`) or a
  server-side Supabase client.
- Inbound patrol-action feedback (11.4 — e.g. "BOLO acted on") remains a
  documented follow-up; there is no inbound surface in this contract yet.

## Not implemented yet (explicitly)

- No bridge worker / FiveM resource exists; nothing polls the feed.
- No sync acknowledgement path (`sync_status` advancement) exists.
- No inbound (in-city → portal) surface exists.
- No portal UI exposes the new kinds/lanes yet — the backend accepts them,
  the site does not offer them.

## Inbound contract (FiveM → CID Portal) — dormant

**Status: forward-looking. No bridge server or FiveM resource is deployed.**
The server-side ingestion surface ships with migration
`20260812120000_surveillance_domain` and is **inert by construction**: its
RPC is EXECUTE-granted to `service_role` only (the same dormancy guarantee
as `mdt_patrol_feed()`), so neither the portal frontend, any signed-in
member, nor a game client can call it.

### The ingestion surface

```sql
public.bridge_ingest_event(
  p_source          text,         -- trusted bridge identifier, e.g. 'fivem-main'
  p_event_type      text,         -- see event types below
  p_source_event_id text,         -- bridge-unique id; idempotency key
  p_event_time      timestamptz,  -- when it happened IN-CITY (source clock)
  p_payload         jsonb         -- event body (schema below)
) returns jsonb  -- {status: processed|duplicate|quarantined, ...}
```

Accepted `p_event_type` values: `fixed_camera`, `alpr`,
`monitored_location`, `vehicle_observation`, `person_observation`,
`meeting_event`, `patrol_submission`.

Required payload fields: `activity` (non-empty text) and `target_id` (the
uuid of an **authorized/active, unexpired** `surveillance_targets` row).
Optional: `location`, `lat`, `lng`, `plate`, `description`.

### Guarantees

- **Authentication** — only the trusted server-side bridge holding the
  `service_role` key may call it. That key is never shipped to a FiveM
  client, a browser, or the portal runtime.
- **Idempotency** — `(source, source_event_id)` is UNIQUE in
  `bridge_ingestion_events`; replaying an event returns
  `{"status":"duplicate"}` and writes nothing.
- **Quarantine, never silent intelligence** — unknown event types, missing
  fields, unknown/unauthorized/expired targets are recorded as
  `status='quarantined'` with the validation error, audited
  (`BRIDGE_EVENT_QUARANTINED`), and produce **no** observation.
- **Server-stamped receipt** — `received_at` is stamped server-side;
  `event_time` (the source clock) is preserved separately on both the
  ingestion row and the observation (`observed_at`).
- **Unverified by default** — every ingested observation lands with
  `verification_status='unverified'` and enters the detective verification
  queue (Action Center). Automated events can never become verified
  investigative facts without a detective's review.
- **Audit trail** — every ingestion outcome writes `audit_log`
  (`BRIDGE_EVENT_INGESTED` / `BRIDGE_EVENT_QUARANTINED`); the raw envelope
  is retained in `bridge_ingestion_events` (command/owner-readable).
- **Rate/abuse protection** — the bridge server is expected to batch and
  rate-limit; server-side, the idempotency key bounds replays and
  quarantine bounds garbage. Additional PostgREST-level rate limiting is a
  deploy-time concern for the bridge service, not a schema concern.

## Sync acknowledgement (outbound) — implemented server-side, dormant

`sync_status` on `mdt_exports` / `mdt_wanted_projections` now has its
acknowledgement path (the "not yet defined" RPC this document previously
called out):

```sql
public.mdt_bridge_ack(
  p_kind   text,  -- 'export' (mdt_exports) | 'wanted' (mdt_wanted_projections)
  p_id     uuid,
  p_result text,  -- 'synced' | 'failed' | 'retryable' | 'pending'
  p_error  text default null
) returns void
```

- EXECUTE-granted to **`service_role` only** — an authenticated browser
  user can never spoof bridge acknowledgement.
- Bookkeeping on both tables: `sync_attempts` (incremented per ack),
  `last_sync_at` (stamped on `synced`), `last_sync_error` (cleared on
  `synced`, recorded otherwise). `mdt_exports` gained these columns in
  `20260812120000`; `mdt_wanted_projections` already carried them.
- Every ack is audited (`MDT_SYNC_ACK`).
- The feed itself remains authoritative: consumers should still diff
  against `mdt_patrol_feed()`; `sync_status` is bookkeeping, not a source
  of truth.
