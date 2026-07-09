# What & why

<!-- One paragraph: what changes and why. Link related feedback items or
handbook sections if relevant. -->

# Merge checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes (zero warnings)
- [ ] `npm test` passes
- [ ] `npm run build` passes (all routes prerender)
- [ ] **Preview verified** — signed in on the Vercel preview and exercised the
      changed flow (two browsers if realtime is involved)
- [ ] **Permissions** — UI gates match the RLS reality; tested as a
      non-privileged account where relevant
- [ ] **Database** (if schema changed) — migration is additive-only, applied
      to the live project, mirrored in `src/lib/database.types.ts`, RLS +
      realtime publication + FK indexes covered, advisors re-run
- [ ] **Docs** — `docs/handbook/` updated if contracts changed
      (`npm run gen:handbook` after), `docs/USER-GUIDE.md` + regeneration if
      member-facing behavior changed, `CHANGELOG.md` entry for releases
- [ ] No secrets introduced (anon/FiveManage keys are the only committable ones)
