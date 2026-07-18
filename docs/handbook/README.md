# CID Portal — Developer Handbook

The project's primary internal documentation. Written so a developer new to
the codebase — even one with limited web-development experience — can
understand, debug, and extend the portal without asking the original
developers anything.

**How to read it**: newcomers, follow the [Learning Path](20-learning-path.md).
Experienced developers, jump straight to the chapter you need — every
chapter stands alone and cross-links the rest.

> **One rule explains this codebase**: *the database is the authority; the
> UI is a convenience.* Every permission check in React only hides buttons —
> Postgres Row Level Security does the real enforcement. Keep that in mind
> and every chapter below gets easier.

## Chapters

| # | Chapter | Read this when you need… |
|---|---|---|
| 1 | [Project Overview](01-overview.md) | What the app is, who uses it, the 30-second architecture |
| 2 | [Repository Tour](02-repository-tour.md) | What every folder is for |
| 3 | [Architecture Blocks](03-architecture.md) | The nine logical blocks, their risk levels, common mistakes |
| 4 | [Feature Guide](04-features.md) | How each feature works end-to-end (data flow included) |
| 5 | [Page Guide](05-pages.md) | Every URL/screen: components, data, permissions |
| 6 | [Components Guide](06-components.md) | The reusable building blocks and when to reuse them |
| 7 | [API Guide](07-api.md) | Every "endpoint" (Supabase REST + every RPC) |
| 8 | [Database Guide](08-database.md) | Every table, policy, function, trigger |
| 9 | [Authentication & Permissions](09-auth.md) | Sign-in flow, roles, the three permission layers |
| 10 | [State Management](10-state.md) | Where data lives and how it moves |
| 11 | [Dependency Map](11-dependency-map.md) | How the systems connect (diagrams) |
| 12 | [Change Impact Guide](12-change-impact.md) | "If I change X, what else must I check?" |
| 13 | [Debugging Guide](13-debugging.md) | Common bugs, where to look, safe workflow |
| 14 | [Development Workflow](14-development-workflow.md) | Setup → run → test → ship |
| 15 | [Coding Conventions](15-conventions.md) | The patterns this repo actually uses |
| 16 | [Best Practices](16-best-practices.md) | Always do / never do, with real examples |
| 17 | [Performance Notes](17-performance.md) | Bottlenecks, current and future |
| 18 | [Security Notes](18-security.md) | The security model and residual risks |
| 19 | [Improvement Ideas](19-improvements.md) | Ranked suggestions (shipped rows marked done) |
| 20 | [Learning Path](20-learning-path.md) | The order to learn all of this |

## Appendices

| Appendix | Contents |
|---|---|
| [Glossary](appendix-glossary.md) | Every technical term, in plain English |
| [File & Folder Index](appendix-file-index.md) | Alphabetical index with one-liners |
| [Quick Reference](appendix-quick-reference.md) | Cheat sheets: commands, env vars, tables, roles |
| [FAQ](appendix-faq.md) | "Where do I add a page?" and other first-week questions |

---

*Sources: the full repository analysis of July 2026 (every source file read;
database sections grounded in the live Supabase catalog). When code and
handbook disagree, the code is right — update the handbook in the same PR.*

*This handbook is also available inside the app (Reference → Developer
Handbook, owner-only), generated from these files by
`npm run gen:handbook` — CI fails if the generated copy drifts.*
