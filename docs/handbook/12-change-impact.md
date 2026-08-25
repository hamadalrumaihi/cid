# Chapter 12 — Change Impact Guide

[← Handbook index](README.md)

| If I change… | Also check… | Why |
|---|---|---|
| A table's schema (live migration) | `database.types.ts` (hand-add), `select` projection strings (grep the column), RLS policies, realtime publication, FK index | Types don't auto-regen; projections fail at runtime; new tables are invisible without policies, stale without publication |
| `PAGE_META` / adding a screen | Category tabs + `TAB_LABEL` + the `[tab]` switch; guide screen-count + regeneration | The three-way nav contract + docs ([FAQ](appendix-faq.md) has the recipe) |
| An Investigative Tools tool (`src/lib/toolsModel.ts`) | `TOOL_TABS`/`TOOL_GROUPS`/`RECORD_PARAM`/`RECORD_TAB_TOOLS`/`RECORD_TITLE_SOURCE` + the component maps in `components/tools/toolRegistry.tsx`; keep the slug in `nav.ts` (redirect contract) | The workspace, the directory, the redirect shim and the RLS-verified restore all read the model; a `ToolId` missing from `TOOL_LIST_COMPONENT` breaks the workspace render |
| `lib/db.ts` contract | Every view's read try/catch and write `res.error` check | Throw-vs-return is assumed app-wide |
| `useAuth` shape / capability booleans | ~40 consumers, Gate branches | canEdit/canDelete gate every button |
| An RLS policy or `private.*` helper | The matching UI gates, `useNavBadges.canReviewCase`, zero-rows checks | UI mirrors must match or users see phantom buttons/badges |
| Sign-off RPCs / routing | `lib/signoff.ts` labels, CaseDetail Sign-off tab, `useNavBadges`, `notifText` types | Vocabulary + mirror + notifications track the server states |
| `FORM_SCHEMAS` field keys | Saved `reports.fields` JSON (old reports must still render), `formToText`, warrant matching | Field keys ARE the storage format |
| A case-satellite FK / cascade | `CaseDetail` delete config; `GangsView`/`PlacesView`/`PersonsView` children/setNullRefs | Undo restores exactly what the config lists |
| `Store` keys | The legacy vanilla app, `page.tsx` deep-link shim, the pre-hydration `PREF_APPLIER` | Shared localStorage blob = cross-app contract |
| A status vocabulary (values or labels) | `lib/status.ts` domain + its source vocabulary (`signoff`/`forms`/`caseCharges`/…), `ui/StatusBadge` call sites, `lib/status.test.ts` | The registry is the single presentation source; a value missing from its domain renders a bare fallback chip |
| `user_prefs`/`user_drafts`/`user_pins` shapes | `lib/savedViews.ts` parse/serialize, `lib/userDrafts.ts` size guard, `lib/pins.ts`, `lib/notifications.ts` mute prefs, the Action Center drafts lane | Owner-only jsonb with size caps — parsers are tolerant (garbage → empty), so a silently-changed shape loses data, not errors |
| `OPTIONAL_NOTIF_CATEGORIES` / notification `type` strings | `lib/notifText.ts` vocabulary, the bell's mute panel, the `create_notification` dedupe (matches on type+payload) | Only allow-listed types are mutable; mandatory streams must never become mutable |
| A saved-view `config` shape (per list) | That list's apply/save functions only (`caseUtils`, registry filter modules) | `lib/savedViews` treats config as opaque — each list owns its own migration/tolerance |
| `globals.css` accent remap / `.nav-collapsed` | Sidebar collapse logic, `PREF_APPLIER`, AppearanceModal | The class/dataset contracts live in three places |
| CSP (`next.config.ts`) | PDF export (WASM), Supabase REST+WSS, FiveManage, Discord | The allow-lists are exact |
| `docs/USER-GUIDE.md` | Regenerate `guideContent.ts` | Dual-copy system |
| An environment variable | `vercel.json` AND `.github/workflows/ci.yml` | Duplicated values must agree; `NEXT_PUBLIC_` values need a rebuild |
| A user's role (data, not code) | The audited RPCs only: `change_member_role` (rank), the `*_transfer` workflow (department), `assign_member` (activation) | `profiles.role/division/active/is_owner/removed_at` are trigger-frozen against every direct client write |
| Component props on a shared UI primitive | All call sites (grep the import) — especially `Modal`'s `dirty`/`onClose` contract | Focus/scroll/discard behavior is relied on everywhere |
