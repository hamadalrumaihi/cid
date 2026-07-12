# Project subagents

Curated Claude Code subagent definitions tailored to the CID Portal — its
design system, RLS-first security model, gates, and governance rules. Spawn
them via the Agent tool (e.g. `subagent_type: "frontend-developer"`).

| Agent | Use it for |
|---|---|
| `frontend-developer` | View/component work, Phase D redesigns, design-system consistency |
| `backend-architect` | Schema, RLS, RPCs, migrations, schema reconciliation |
| `test-automation-engineer` | Unit / RLS / Playwright functional + visual tests |
| `security-reviewer` | Security review of data-access/auth/input changes (read-only) |
| `qa-verifier` | Run the gates and verify a change actually works before shipping |

These are **development-time** tooling only — not part of the app runtime, and
they carry no secrets. The taxonomy was inspired by
[msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents)
(MIT); the content here is written for this repository rather than copied, so
each agent knows our conventions instead of generic ones. Add more sparingly —
prefer a few sharp, project-aware agents over a large generic roster.
