# Uploads — Uppy pilot (Case Detail → Photos & Media)

Phase 3 of the integration program: the **Add photos** modal on a case's
Photos & Media tab now runs its file uploads through a headless
[Uppy](https://uppy.io) queue instead of a fire-and-forget `fetch` loop.
This is the ONLY surface on the pilot — every other upload site
(vault MediaView, case files, places, persons, gangs, profile avatar) still
calls `fmUpload()` in `src/lib/fivemanage.ts` single-shot.

## What changed

| Piece | File | Role |
| --- | --- | --- |
| Adapter | `src/lib/uppyFivemanage.ts` | `@uppy/core` + `@uppy/xhr-upload` wired to the FiveManage transport contract; framework-free queue (subscribe/getSnapshot) with per-file byte progress, retry, remove, cancel-pending |
| Upload panel | `src/components/cases/tabs/MediaUploadPanel.tsx` | Drag-drop + browse UI, queue rows, progress bars — portal tokens only (ink surfaces, accent via the `badge-*`/`blue-*` remap, `Button` primitive) |
| Pilot surface | `src/components/cases/tabs/MediaTab.tsx` (`AddPhotosModal`) | Renders the panel via `next/dynamic` (ssr:false); owns the media-row insert and the post-upload details editor, both unchanged |
| Tests | `src/lib/uppyFivemanage.test.ts`, `tests/msw/uppy-fivemanage.test.ts` | Pure mapping contract (unit) + full lifecycle against the MSW fivemanage handler |

New runtime dependencies (approved for this integration): `@uppy/core`,
`@uppy/xhr-upload`. Nothing else — no `@uppy/react`, no Dashboard, no
Companion/Transloadit (paid/infra), headless only.

### Transport contract (unchanged — now enforced by tests)

The adapter reproduces `fmUpload()` byte-for-byte on the wire:

- `POST ${NEXT_PUBLIC_FIVEMANAGE_BASE_URL}/api/{image|video|audio}` — kind
  from the MIME prefix, **image fallback** for anything else;
- multipart field named **by kind** (`image`/`video`/`audio`, never `file`),
  plus a `metadata` part = `JSON.stringify({ name })`;
- `Authorization: <raw key>` — **no `Bearer` prefix**;
- `Content-Type` left to the browser (FormData boundary);
- hosted URL read from `url` || `link` || `data.url`; a 2xx without a usable
  URL is a failure;
- non-2xx surfaces the server's own `message`/`error` verbatim
  (falls back to `HTTP <status>`).

CSP already allows `api.fivemanage.com` (`connect-src`), so no header change
was needed.

### Two-phase seam (deliberately preserved)

1. **Host first** — the file uploads to FiveManage;
2. **Insert second** — `AddPhotosModal` inserts the `media` row
   (`saved:false`, title from the filename, `tags.source_filename`), then the
   user edits caption/category/links and saves details.

A row never exists without a hosted URL. If the insert fails *after* a
successful host upload, the queue row goes to **`save-failed` — "Hosted, not
saved"** (danger toast + inline error) and its Retry re-runs the insert
alone, without re-uploading bytes. The file is never shown as done until the
row is in the database.

### Queue semantics

- Per-file states: `queued → uploading → saving → done`, with `upload-failed`
  (retry re-uploads) and `save-failed` (retry re-inserts) side exits.
- Real byte progress per file plus an overall bar; 100 MB/file cap and
  `image/* video/* audio/*` acceptance enforced client-side **before** a byte
  leaves the browser (`restriction-failed` → warn toast).
- **Cancel pending** aborts queued/uploading files only; hosted, failed and
  done rows keep their state (clear partial-success reporting).
- The modal's Done button stays disabled while anything is in transit, and
  the dirty-close guard also arms while unresolved failures remain.
- The file input resets its value after every selection, so re-picking the
  same file works (long-standing input bug class).
- Uppy loads **lazily**: `MediaUploadPanel` is a `next/dynamic` (ssr:false)
  chunk imported when the modal opens with a configured key, so
  `check:bundle` (shared first-load budget) is untouched.

## What deliberately did NOT change

- **No resumable/chunked uploads (`@uppy/tus`, Golden Retriever).**
  FiveManage is a single-shot `POST` destination — there is no tus/resumable
  endpoint to speak to, and the CSP has no `worker-src`/`blob:` allowance
  Golden Retriever's service worker would need. The 100 MB cap keeps
  single-shot honest.
- **No Webcam plugin.** The `Permissions-Policy` header blocks `camera`
  portal-wide; a capture UI would dead-end at the permission prompt.
- **No Companion / remote sources / Transloadit.** Paid or infra-carrying —
  out of scope per governance (free packages only).
- **The paste-a-URL fallback is byte-identical.** It remains the ingest path
  when `NEXT_PUBLIC_FIVEMANAGE_API_KEY` is absent (CI's E2E asserts the
  "File upload is not configured" notice and drives ingest through it), and
  it still covers externally hosted clips.
- **DB ordering, RLS, and the details-after-upload flow** — untouched. The
  insert still happens through `insert('media', …)` from `@/lib/db`; archive/
  delete/restricted-media flows are unaffected.

## Extending to other surfaces later

The adapter is intentionally view-agnostic:

1. Reuse `createFmUploader({ onUploaded, onRejected, onUploadFailed })` —
   `onUploaded` is *your* persistence step (vault insert, avatar update, …);
   throw from it to get the `save-failed`/retry-insert behaviour for free.
2. Subscribe with `useSyncExternalStore(u.subscribe, u.getSnapshot,
   u.getSnapshot)` — see `MediaUploadPanel` for the reference wiring
   (latest-callback ref, `onQueueChange` mirroring, unmount `cancelPending`).
3. Keep the panel (or your own UI) behind `next/dynamic` so `@uppy/*` stays
   out of eagerly-loaded route chunks, and keep the surface's existing
   no-key fallback intact.
4. Promote shared pieces (e.g. moving the panel to `src/components/ui/`)
   only when a second surface actually adopts it — one consumer is not an
   abstraction.

Testing pattern: MSW's fivemanage handler (`src/mocks/handlers/fivemanage.ts`)
plus `failedUpload()` / `setFivemanageFailure(null)` from the mock store give
deterministic success/failure/recovery without network —
`tests/msw/uppy-fivemanage.test.ts` is the template.
