# Appendix — Glossary

[← Handbook index](README.md)

Plain-English definitions of every technical term the handbook uses.

| Term | Meaning here |
|---|---|
| **Component** | A reusable piece of UI written as a function returning HTML-like markup (JSX). `<CaseBoard />` is a component. |
| **Props** | The inputs a component receives, like function arguments. |
| **State** | Data a component remembers between renders (`useState`). Changing it re-renders the component. |
| **Hook** | A `use…` function that gives a component access to React features. Custom hooks (`useTableVersion`) bundle reusable behavior. |
| **Effect** | Code that runs after render (`useEffect`) — used here for data fetching. House rule: defer state-setting effects via `setTimeout(0)`. |
| **Context / Provider** | React's way to share a value (like "who is signed in") with every component underneath, without passing props down each level. |
| **Store (zustand)** | A small global state container outside the component tree — needed so non-React code (the data layer) can push toasts. |
| **`Store` (this repo)** | Confusingly also the name of the localStorage wrapper (`lib/store.ts`) for device preferences. Unrelated to zustand. |
| **Route / Page** | A URL the app responds to. One dynamic route (`[tab]`) serves all 29 screens. |
| **API / Endpoint** | An HTTP URL a program calls. Here: Supabase's auto-generated `/rest/v1/<table>` and `/rest/v1/rpc/<fn>`. |
| **SQL / Postgres** | The database language / the database engine Supabase hosts. |
| **Query** | A request for data (SQL SELECT, or the `list()` helper). |
| **Migration** | A versioned SQL script changing the database's shape. Additive-only in this project. |
| **RLS (Row Level Security)** | Postgres policies deciding, per row and per user, whether SELECT/INSERT/UPDATE/DELETE is allowed. The heart of this app's security. |
| **Policy** | One RLS rule on one table for one operation. |
| **Trigger** | SQL that runs automatically before/after a row changes — used for audit logs, timestamps, and blocking protected columns. |
| **RPC** | Calling a named database function over HTTP — used for atomic, permission-checked, multi-step operations. |
| **SECURITY DEFINER / INVOKER** | Whether a database function runs with its owner's privileges (definer — then it must check the caller itself) or the caller's (invoker). |
| **JWT / Session** | A signed token proving who you are; stored by the Supabase client and attached to every request, auto-refreshed hourly. |
| **Realtime / Subscription / Websocket** | Supabase pushes a message over a persistent connection when a table changes; the app turns these into version counters. |
| **Promise / async–await** | JavaScript's way to handle operations that finish later without freezing the page. |
| **Cache** | Kept-around data to avoid refetching. Here: the profiles cache, localStorage, browser HTTP cache — deliberately no general data cache. |
| **Webhook** | A call a service makes *to you* on an event — used only by the dev workflow (GitHub→CI), not the app. |
| **CSP (Content-Security-Policy)** | A response header allow-listing what the page may load/connect to. Lives in `next.config.ts`. |
| **Anon / publishable key** | The Supabase client key shipped in the bundle. Public by design — it grants nothing RLS doesn't allow. |
| **service_role key** | The Supabase key that BYPASSES RLS. Never in this repo, never in the client. |
| **Hydration** | React attaching interactivity to server-rendered HTML. The theme applier runs pre-hydration to avoid a flash. |
| **Portal** | Rendering a component outside its parent DOM node (modals/toasts render into `<body>`). |
| **Sequence guard** | A counter/flag ensuring only the newest async request's result is applied. |
| **CAS (compare-and-swap)** | An update that only applies if a column still has an expected value — prevents two tabs double-firing. |
| **pg_trgm** | The Postgres extension powering typo-tolerant search. |
| **Bureau** | A sub-division (`LSB`/`BCB`/`SAB`/`JTF`); most case access is scoped to it. |
| **Sign-off chain** | The server-routed approval flow: bureau lead → deputy director → director. |
| **Deconfliction** | Detecting the same identifier/person across separate cases. |
| **BOLO** | "Be on the lookout" — flagged persons. |
| **RICO / predicate act** | The racketeering case wrapper and its qualifying acts. |
| **Packet / dossier** | The court-ready case export / the per-person export. |
