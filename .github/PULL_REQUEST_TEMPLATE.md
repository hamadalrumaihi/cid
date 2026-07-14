# What & why

<!-- One paragraph: what changes and why. Link related feedback items or
handbook sections if relevant. -->

# Merge checklist

- [ ] Typecheck passes
- [ ] Lint passes (zero warnings)
- [ ] Unit tests pass
- [ ] Build passes (all routes prerender)
- [ ] Schema check passes (`npm run check:schema`)
- [ ] RLS tests pass (live suite; required for any data-access change)
- [ ] E2E tests pass or failures are documented (isolation re-runs noted)
- [ ] New permissions have allow and deny tests
- [ ] **Preview verified** — signed in on the Vercel preview and exercised the
      changed flow (two browsers if realtime is involved; non-privileged
      account where permissions are involved)
- [ ] **Database** (if schema changed) — migration is additive-only, applied
      to the live project, mirrored in `src/lib/database.types.ts` +
      `supabase/schema-snapshot.sql`, RLS + realtime publication + FK indexes
      covered, advisors re-run
- [ ] Documentation updated (`docs/handbook/` + `npm run gen:handbook` for
      contract changes, `docs/USER-GUIDE.md` + `npm run gen:guide` for
      member-facing changes, reviewer docs for permission/workflow changes,
      `CHANGELOG.md` entry for releases)
- [ ] No secrets introduced (anon/FiveManage keys are the only committable ones)
- [ ] No test fixtures shown to normal users
