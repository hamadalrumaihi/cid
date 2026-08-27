# Error Codes

Eight stable codes. Every operation returns either a result or exactly one of
these. Codes are stable strings — **branch on `error`, never on `message`**
(messages are for humans and may change without notice).

Response shape on failure:

```json
{ "error": "conflict", "message": "human-readable detail" }
```

| code | HTTP | meaning | client action |
|---|---|---|---|
| `unauthorized` | 401 | Missing/bad integration secret, unknown or disabled source, or an expired officer session. | Re-run the identity exchange; if the secret is rejected, stop and escalate — do not retry-loop. |
| `forbidden` | 403 | The authenticated officer (or machine identity) may not perform this operation, or the officer has no active mapping. | Surface to the officer. Do not retry — authority will not change between retries. |
| `not_found` | 404 | The addressed record does not exist **or is invisible to this officer**. The two cases are never distinguished. | Treat as absent. Do not infer existence from a 404. |
| `conflict` | 409 | The request was valid but current state forbids it: an illegal status transition, an occupied uniqueness slot, an in-flight duplicate request. | Refetch state, then decide. Not retryable as-is. |
| `duplicate` | 200 | Idempotent replay: this `(source, externalRequestId)` was already processed. The body carries the stored outcome of the original request. **Not a failure; nothing was written twice.** | Treat exactly like the original success. |
| `validation_failed` | 422 | Malformed payload, missing required field, unknown enum value, missing `externalRequestId` on a mutation — or an operation documented as FUTURE. | Fix the request; do not retry unchanged. |
| `rate_limited` | 429 | The source is over its per-minute budget. | Back off and retry later **with the same `externalRequestId`** — idempotency makes this safe. |
| `internal` | 500 | Unexpected portal-side failure. | Retry with the same `externalRequestId` (bounded, with backoff). The idempotency layer guarantees no double-write. |

The dormant skeleton additionally returns `501 { "error": "not_activated" }`
for every operation — deliberately outside this vocabulary so a not-yet-live
deployment is unmistakable. Treat it as "the CID lane is not active".
