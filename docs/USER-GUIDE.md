# CID Portal — User Guide

**The user guide lives in the portal, at `/guides/user-guide`.**

It is one of the guides in the **Guide Library** (`/guides`), alongside the
Case Management, Reports and Evidence, Legal Requests, Action Center and
Entities and Organizations guides. Every member reads it there, in the portal
it describes, with the navigation and the screens in front of them.

## Where the text is

| | |
|---|---|
| **The reader's address** | `/guides/user-guide` |
| **The prose** | [`src/components/guides/docs/userGuideDoc.ts`](../src/components/guides/docs/userGuideDoc.ts) — a typed document module, code-reviewed like any other change |
| **The library row** | `public.guides` (`slug = 'user-guide'`) — title, summary, category, audience, publication state |
| **The other guides** | `src/components/guides/docs/` — one module each |

There is deliberately **one copy**. This file used to hold the canonical text
and `scripts/generate-guide.mjs` copied it into the app; that dual-copy
arrangement drifted, so the module is now the only source and this page is a
signpost to it. The previous markdown is kept, unedited, at
[`docs/archive/USER-GUIDE-2026-09.md`](archive/USER-GUIDE-2026-09.md) for
history — it describes the portal as it stood before the September 2026 guide
audit and should not be read as current.

## Changing a guide

1. Edit the document module (or, for a guide written in the portal, use the
   editor on `/guides` — Command and the Owner only).
2. Open a pull request: guide prose is reviewed like code, with the diff
   visible.
3. The library row — title, summary, category, audience, pinned, published —
   is changed in the portal, not here.

## Related documents

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — how the portal is built
- [`WORKFLOWS.md`](WORKFLOWS.md) — what each workflow does end to end
- [`AUTHORIZATION.md`](AUTHORIZATION.md) — who may do what, and where it is enforced
- The **SOPs & Library** page in the portal — policy and standing orders. A
  guide explains how to use a portal feature; an SOP says what you are
  required to do. They are not the same document and neither duplicates the
  other.
