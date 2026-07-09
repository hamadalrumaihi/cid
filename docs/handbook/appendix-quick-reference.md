# Appendix — Quick Reference

[← Handbook index](README.md)

## Commands

```bash
npm run dev          # local dev server (http://localhost:3000)
npm run build        # production build — all routes must prerender
npm start            # serve the production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src --max-warnings 0
npm test             # vitest run
# the pre-push ritual:
npm run typecheck && npm run lint && npm test && npm run build
```

Deploy = merge to `main` (Vercel tracks it; PRs get preview URLs;
rollback via Vercel dashboard → Deployments → Rollback).

## Environment variables (all public; committed in vercel.json + ci.yml)

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project API URL (required) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable key (required; RLS is the boundary) |
| `NEXT_PUBLIC_FIVEMANAGE_API_KEY` | Upload key (optional — uploads off without it) |
| `NEXT_PUBLIC_FIVEMANAGE_BASE_URL` | FiveManage host (optional) |

## Roles & capability booleans

| Tier | Roles | canEdit | canDelete/isCommand |
|---|---|---|---|
| (inactive) | any, `active=false` | ✗ | ✗ |
| Member | detective, senior_detective | ✓ | ✗ |
| Command | bureau_lead, deputy_director, director | ✓ | ✓ |

Bureaus: `LSB` · `BCB` · `SAB` · `JTF`. Sign-off chain:
bureau_lead → deputy_director → director.

## The db.ts contract

| Helper | Errors |
|---|---|
| `list`, `custodyForCase` | **throw** — wrap in try/catch |
| `insert/update/updateWhere/updateNoSelect/remove/removeWhere/rpc` | **return `{error}`** — check it; empty-data update = blocked |
| `withRetry` | reads only |
| `deleteWithUndo` | confirm + 6s Undo; configure `children`/`setNullRefs` |

## Main RPCs

`search_all` · `signoff_submit/decide/owner_action` · `report_finalize` ·
`assign_member` · `admin_member_emails/remove/restore` ·
`create_notification` · `mo_crossref` ([Ch. 7](07-api.md)).

## Database tables (47), by RLS pattern

- **Case-scoped**: cases, case_assignments, evidence, custody_chain,
  reports, case_tasks, case_messages, case_intel_links, case_files,
  case_signoff_history, rico_cases, predicate_acts, mo_profiles,
  raid_compensations, trackers, case_access_grants/requests,
  case_templates
- **Shared intel**: persons, gangs, gang_ranks, gang_members, gang_turf,
  vehicles, places, place_process_steps, narcotics, narcotic_precursors,
  narcotic_hotspots, ballistics_benches, ballistic_footprints, indicators,
  media, cid_records, operations, tickets, commendations, documents,
  documents_versions
- **Own-row**: notifications, watchlist, shift_reports, feedback, profiles
- **System**: audit_log, announcements, app_secrets

## Remaining enums

`assign_role`: primary/support · `report_kind`: initial/supplemental/
followup · `evidence_tamper`: intact/compromised/released/destroyed ·
`media_type`: image/video/fivemanage/document · `doc_kind`:
doc/sheet/pdf/zip · `location_type`: drug_lab/stash_house/dead_drop/
front_business/chop_shop · `bench_type`: street/organized ·
`tracker_status`: pending/authorized/expired · `threat_level`/`density`:
low/medium/high.

## Keyboard shortcuts (in-app)

`/` focus search · `Ctrl/⌘-K` command palette · arrows+Enter in palette ·
Enter submits quick-add rows.

## localStorage keys (the `cid-portal-v3` blob — legacy-shared, don't rename)

`tab` · `collapsed` · `accent` · `density` · `annSeen` · `annDismissed` ·
`casesScope` · `casesView` · `caseFilters` · `caseViews` · `recentCases` ·
`pinnedCases` · `benchType` · `watchSeen` · `recentSearches` ·
`graphLayout:<caseId>`.
