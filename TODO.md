# To-do

- [ ] Research 3D map view - solar system
- [x] Push gate: also catch GitHub MCP push tools, not just shell commands (docs/audit-2026-11-06.md #1)
- [x] Say in README and runs.ts that local programs can read the page token (audit #2)
- [x] Orders: stop two overlapping checks from starting two questions at once (audit #3)
- [ ] Honour CLAUDE_CONFIG_DIR for the session list and "What agents can touch" (sessions.ts, setup.ts), not only Plan left (audit #4, wider in 2026-11-09 audit #5)
- [x] Share one pushError helper between orders.ts and todo.ts (audit #5)
- [ ] Keep one midnight() in datasets.ts and import it in Data.tsx (2026-11-09 audit #6)
- [ ] Order branches claude/a-b and claude/a/b get the same worktree folder, so the second run fails
