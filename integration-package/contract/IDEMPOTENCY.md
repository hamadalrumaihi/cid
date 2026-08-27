# Idempotency Rules

The rule in one line: **a retry can never write twice.**

## The key

- Every **mutating** operation must carry an `externalRequestId` — minted by
  your side, **source-scoped**, and stable across retries of the same logical
  action. Reads carry none.
- The idempotency key is `(source, externalRequestId)`. For the surveillance
  machine lane it is `(source, sourceEventId)`.
- A correlation/trace id may also be sent, but it is deliberately **not**
  part of the key: a resend may mint a new trace id for the same event.
- Whitespace noise in ids is normalized for matching (trim, collapse internal
  whitespace); case and interior punctuation are preserved. An empty key
  component on a mutation fails loudly with `validation_failed` — it never
  silently collides.

## Replay semantics

When a key arrives that was already **resolved successfully**, the response
is the stored outcome of the original request with code `duplicate`
(HTTP 200). **No second write occurs.** Treat it exactly like the original
success.

Not every prior state marks a replay:

| stored state of the key | a resend is… |
|---|---|
| processed / duplicate | a replay ⇒ `duplicate`, stored outcome returned |
| failed / retryable | a **legitimate retry** ⇒ the operation runs again |
| pending / quarantined | in flight or held ⇒ `conflict`; back off and re-poll |

## What this buys you

- `internal` (500) and `rate_limited` (429) are always safe to retry with
  the **same** `externalRequestId` — bounded, with backoff.
- Network timeouts are safe: if the original landed, the retry replays its
  outcome; if it didn't, the retry performs it once.
- Never mint a fresh `externalRequestId` for a retry — that is how double
  writes happen, and it is the one client bug this contract cannot absorb.

## Choosing ids

Any scheme that is unique per logical action within your source works:
UUIDs minted at user-action time, or deterministic ids like
`case-create:<city-incident-id>`. Deterministic ids are preferred where a
natural key exists — they make accidental double-submission from your UI
idempotent for free.
