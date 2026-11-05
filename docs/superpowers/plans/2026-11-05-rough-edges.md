# Rough Edges and Hurdles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the items under "Rough edges in the scaffold" and "Hurdles" in `docs/PLAN.md` that code can fix, grouped so that each change fixes several items in the same files.

**Architecture:** Eight tasks, each owning one or two files, and each closing two to four items. Runs get a small on-disk record in the repo's own git folder, which makes them survive restarts and lets the app remove their folders. Session logs gain a "turn over" flag, which gives lamps a third state and a count of unreadable logs. The catch-up brief returns its exact commits, which fixes both shading problems in Tracks. The rest are small changes in `setup.ts`, `enable.ts`, `orders.ts` and `git.ts`.

**Tech Stack:** Node 24 (runs `.ts` directly), git 2.38 or newer (`merge-tree --write-tree`; this PC has 2.56), React 19, Tailwind 4, `node:test`. No new dependencies.

**Spec:** the "Rough edges in the scaffold" and "Hurdles" lists in `docs/PLAN.md`. Each task names the items it closes, quoted by their first words.

## What was checked (2026-11-05)

Every item in both lists is still current. None has been fixed since it was written. Two notes:

- The Claude desktop app's `scheduled-tasks.json` is still empty here, so its format is still unknown. The schedules item stays as it is.
- The Windows `node-pty` hurdle only matters if real terminals are ever added. Nothing planned needs them.

Items with no task, left in `PLAN.md` as known limits: orders arrive only while the app is open; `claude/*` branches count as orders; Map drawing limits; schedules; forked chats; the small parsers; claude.ai connectors and command-line permissions; the to-do list limits; the API inside Vite (step 15 packages it); only Claude Code and Codex logs (step 10 adds OpenCode). Hurdles with no code fix: cloud sessions, briefs carrying other people's words, Codex and `.git`, API relays, Windows terminals, scope creep.

## Global Constraints

- **Commits only when the owner asks** (owner's CLAUDE.md). When asked, make one commit per task with the subject given in its last step, ending with `Agent: <your tool>` and `Why: <one line>` trailers (this repo's AGENTS.md).
- **Checks:** `npm test` (all of `node --test test/*.test.ts`) and `npm run check` (`tsc --noEmit`) pass at the end of every task.
- **No new dependencies, options or abstractions** beyond what a task names. Comments only say why, in one line. A known limit gets `// shortcut: <the limit>, <when to upgrade>`.
- **Writes stay behind the page token.** Every new POST route goes through `write()` in `server/api.ts`, after the token check.
- **Never lose work:** no `--force` on `git worktree remove`, and never delete a branch.
- **Docs travel with the code.** Each task's last step rewrites or removes its items in `docs/PLAN.md` and updates the README where it describes the changed behaviour.

## Review Focus

1. **A damaged run record** (half-written or edited JSON in the run store) is skipped, and `/runs` still lists the others. Pinned in Task 1, test `run records survive a restart, and a damaged one is skipped`.
2. **Removing an order's folder** keeps its branch and its unsent `report.md` commit. Pinned in Task 2, test `a finished run's folder can be removed, never with uncommitted work, and its branch stays`.
3. **A detached or empty checkout** gives the review `merge: null` instead of an error. Pinned in Task 2, same test file, test `review says whether the branch merges cleanly`.
4. **An edited note section** in `AGENTS.md` is left alone by `disable` and reported, so the owner's own text is never deleted. Pinned in Task 6, test `disable leaves a note it didn't write`.
5. **A chat interrupted with Esc** counts as "your turn", not "working". Claude Code logs it as a user entry that starts with `[Request interrupted`. Pinned in Task 3, test `a session knows whose turn it is`.

---

### Task 1: Runs that survive reloads and restarts, and say when they go quiet

Closes: "The API runs inside the Vite dev server … Editing a server file reloads it, which forgets started runs and makes a new token", "Runs live in memory", "A run has no time limit".

**Files:**
- Modify: `server/runs.ts` (the `runs` map, `Live`, `update()`, `startRun()`, `listRuns()`)
- Modify: `server/api.ts` (the `token`, and the `/runs` read route)
- Test: `test/runs.test.ts`

**Interfaces:**
- Produces:
  - `loadRuns(repos: string[]): Promise<void>`: reads every `<repo>/.git/omni/runs/*.json` and adds runs whose id isn't in the map yet, so calling it again is cheap and harmless. It runs no git commands, because `/runs` is polled every 3 seconds. A run saved as `running` or `waiting` comes back as `stopped`, with the note line `The server restarted during this run, so its later output isn't shown. Review its branch.`
  - `checkQuiet(now = Date.now()): void`: adds the note line `No output for 10 minutes. A tool that can't reach its API waits silently, so use Stop if this goes on.` once to each `running` run whose last output is older than `STALL_MS = 10 * 60_000`. New output re-arms it. Runs with status `waiting` are skipped.
  - `Live` gains `file: string`, `quietSince: number` and `warned: boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
test('run records survive a restart, and a damaged one is skipped', async () => {
  const store = join(repo, '.git', 'omni', 'runs')
  const done = await startRun(repo, { tool: 'Claude Code', task: 'save me' }, address(), fake('quick'))
  await until(done.id, (r) => r.status === 'finished')
  assert.equal(JSON.parse(readFileSync(join(store, `${done.id}.json`), 'utf8')).status, 'finished')
  writeFileSync(join(store, 'aaaaaa.json'), JSON.stringify({ ...done, id: 'aaaaaa', status: 'running' }))
  writeFileSync(join(store, 'bbbbbb.json'), '{"id": "bbbb')
  await loadRuns([repo])
  const back = listRuns().find((r) => r.id === 'aaaaaa')!
  assert.equal(back.status, 'stopped')
  assert.ok(!listRuns().some((r) => r.id === 'bbbbbb'))
})

test('a quiet run gets one warning', async () => {
  const run = await startRun(repo, { tool: 'Claude Code', task: 'hang' }, address(), fake('hang'))
  checkQuiet(Date.now() + 11 * 60_000)
  checkQuiet(Date.now() + 12 * 60_000)
  assert.equal(watchRun(run.id, () => {}).run.lines.filter((l) => l.text.startsWith('No output for 10 minutes')).length, 1)
  stopRun(run.id)
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test test/runs.test.ts`
Expected: FAIL, because `loadRuns` and `checkQuiet` aren't exported.

- [ ] **Step 3: Implement it in `server/runs.ts`**

- Keep the map on `globalThis` (`globalThis.omniRuns ??= new Map()`), so Vite reloading the module keeps live runs and their child processes. Do the same for a single `setInterval(checkQuiet, 60_000).unref()`, so a reload doesn't start a second one.
- `startRun` sets `live.file` to `join(repo, '.git', 'omni', 'runs', `${id}.json`)`. `repo` is always a main checkout found under the roots, so `.git` is a folder. Using the repo's own git folder means tests write only to their temp repos, and removing a repo removes its records. If the write fails, the run carries on unsaved.
- `update()` saves `live.run` with `writeFileSync` when the status changes, and otherwise at most every 2 seconds. The close handler always saves, and so does `quietSince = Date.now(); warned = false` on new lines.
- `loadRuns` skips files that don't parse.
- Replace the `// shortcut: runs live in memory…` comment with one that says records live in `.git/omni/runs/`.

- [ ] **Step 4: Keep the token across reloads in `server/api.ts`**

`export const token = (globalThis.omniToken ??= randomBytes(24).toString('hex'))`, with a one-line comment saying why. The `/runs` read route calls `await loadRuns(await findRepos(roots()))` before `listRuns()`.

- [ ] **Step 5: Run the checks**

Run: `npm test` and `npm run check`
Expected: all pass.

- [ ] **Step 6: Docs and commit**

In `PLAN.md`, change the dev-server line to say a server-file edit no longer forgets runs or the token, while a production build still waits for step 15. Delete "Runs live in memory". Change "A run has no time limit" to say the run warns after 10 quiet minutes. In the README's "Starting an agent", add one bullet: runs are kept in `.git/omni/runs/` and listed again after a restart. Commit subject: `Keep runs across restarts, and warn when one goes quiet`.

---

### Task 2: The review shows merge conflicts and can remove the folder, and a run says who pays

Closes: "The app never removes worktrees", the README's "Order folders stay until you remove them", the "Merge conflicts" hurdle and part of the "Terms of use" hurdle (which login a run bills).

**Files:**
- Modify: `server/runs.ts` (`reviewRun()`, a new `removeRun()`, `startRun()`'s first line)
- Modify: `server/api.ts` (`write()`: `/runs/remove`)
- Modify: `src/Runs.tsx` (`RunPanel`'s review section)
- Test: `test/runs.test.ts`

**Interfaces:**
- Consumes: `Live.file` (Task 1).
- Produces:
  - `reviewRun(id)` also returns `merge: { into: string; conflicts: string[] } | null`. `into` is the main checkout's current branch. `conflicts` lists the files `git merge-tree --write-tree --name-only --no-messages <into> <run.branch>` reports, and is empty when the branch merges cleanly. It is `null` when the checkout is detached. Exit code 1 means conflicts, so read stdout from the rejected `git()` error (`e.stdout`).
  - `removeRun(id: unknown): Promise<{ removed: string }>`: refuses a `running` or `waiting` run with `Stop the run first.`. It runs `git worktree remove <worktree>` without `--force`. When git refuses because of changes, it throws `The folder has uncommitted changes. Commit or copy what you need, then remove it with git worktree remove --force.` Otherwise it deletes the run's record and drops it from the map. The branch stays.
  - Claude Code runs start with the note line `Bills your API key, because ANTHROPIC_API_KEY is set.` or `Uses your Claude Code login.`

- [ ] **Step 1: Write the failing tests**

```ts
test('review says whether the branch merges cleanly', async () => {
  // A run that commits a change to README.md, while the main checkout changes the same line.
  … // build both commits with git(), then:
  assert.deepEqual((await reviewRun(run.id)).merge, { into: 'main', conflicts: ['README.md'] })
  await git(repo, 'checkout', '-q', '--detach')
  assert.equal((await reviewRun(run.id)).merge, null)
  await git(repo, 'checkout', '-q', 'main')
})

test("a finished run's folder can be removed, never with uncommitted work, and its branch stays", async () => {
  const run = … // a finished run whose worktree has an untracked file
  await assert.rejects(removeRun(run.id), /uncommitted changes/)
  rmSync(join(run.worktree, 'left.txt'))
  await removeRun(run.id)
  assert.ok(!existsSync(run.worktree))
  assert.ok(await rev(repo, `refs/heads/${run.branch}`))
  assert.ok(!listRuns().some((r) => r.id === run.id))
})

test('a Claude Code run says which login it bills', async () => { … first line matches /Uses your Claude Code login|Bills your API key/ })
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test test/runs.test.ts`
Expected: FAIL, because `removeRun` isn't exported and `merge` is undefined.

- [ ] **Step 3: Implement `reviewRun`'s `merge`, `removeRun` and the billing line in `server/runs.ts`, and the `/runs/remove` route in `server/api.ts`**

- [ ] **Step 4: Show it in `RunPanel` in `src/Runs.tsx`**

Under the review, show `Merges cleanly into main.` or `Conflicts with main in: a.ts, b.ts. Merge it yourself and decide each one.`. Once the run is over, show a **Remove folder** button. It posts `/api/runs/remove`, then closes the panel, and shows the error in the existing `role="alert"` line.

- [ ] **Step 5: Run the checks, and click it once in the browser on a scratch repo**

Run: `npm test` and `npm run check`. In the browser, a finished run in a scratch repo shows the merge line, and Remove folder takes the folder away.

- [ ] **Step 6: Docs and commit**

In `PLAN.md`, delete "The app never removes worktrees". Change the "Merge conflicts" hurdle to say the review shows conflicts before you merge. In the "Terms of use" hurdle, add that each run's first line says which login it bills. In the README, change the "Cleaning up" bullet and the orders "Leftovers" line to point at Remove folder. Commit subject: `Show merge conflicts and remove a run's folder from its review`.

---

### Task 3: Lamps say "working" or "your turn", and unreadable logs are counted

Closes: "Lamps for chats you started yourself still mean 'log touched in the last 10 minutes'" and the "Log formats can change" hurdle (you now see when it happens).

**Files:**
- Modify: `server/sessions.ts` (`Session`, `readClaude()`, `readCodex()`, `allSessions()`)
- Modify: `server/api.ts` (`/roster` adds `logs`)
- Modify: `src/ui.tsx` (a new `sessionLamp()`), `src/App.tsx` (lines 82 and 166), `src/Roster.tsx` (line 72 and a note), `src/Tracks.tsx` (drop `ACTIVE_MS`, use `sessionLamp`)
- Test: `test/sessions.test.ts`

**Interfaces:**
- Produces:
  - `Session.turnOver: boolean`. For Claude Code, an `assistant` entry sets it to `stop_reason === 'end_turn'`. A `user` entry sets it to `false`, unless its text starts with `[Request interrupted`, which sets it to `true`. For Codex, `event_msg` with `payload.type === 'task_complete'` sets `true`, and `task_started` sets `false`.
  - `export let lastScan = { files: 0, unread: 0 }` in `sessions.ts`, set by each `allSessions()` call. `unread` counts logs that were rejected or gave no `cwd`.
  - `sessionLamp(s: Session): 'run' | 'wait' | 'off'` in `src/ui.tsx`: `off` when not `isLive(s)`, `wait` when `s.turnOver`, else `run`. Lamp labels are `Working` and `Waiting for you`.
  - `/roster` returns `logs: lastScan`.

- [ ] **Step 1: Write the failing tests**

```ts
test('a session knows whose turn it is', async () => {
  // Three temp Claude logs: ending in assistant end_turn, in a user tool_result, and in a user "[Request interrupted by user]" entry.
  assert.deepEqual([await readClaude(ended), await readClaude(working), await readClaude(interrupted)].map((s) => s.turnOver), [true, false, true])
  // A Codex log ending in task_complete, and one ending in task_started.
  assert.deepEqual([await readCodex(complete), await readCodex(started)].map((s) => s.turnOver), [true, false])
})

test('logs that give no session are counted', async () => {
  // A temp home with one good Claude log and one holding only `{"type":"something-new"}`.
  await allSessions(home)
  assert.deepEqual(lastScan, { files: 2, unread: 1 })
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test test/sessions.test.ts`
Expected: FAIL, because `turnOver` is undefined and `lastScan` isn't exported.

- [ ] **Step 3: Implement it in `server/sessions.ts` and add `logs` to `/roster` in `server/api.ts`**

- [ ] **Step 4: Use `sessionLamp` at every lamp that shows a chat**

For the agent rows in `App.tsx`, show the busiest state among the agent's chats: run, then wait, then off. When `logs.unread > 0`, the Roster shows: `{unread} of {files} session logs couldn't be read. Claude Code or Codex may have changed their log format, so some chats may be missing.`

- [ ] **Step 5: Run the checks, and look at the Roster in the browser**

Run: `npm test` and `npm run check`. This chat's lamp shows green while a reply is being written, and amber after it ends.

- [ ] **Step 6: Docs and commit**

In `PLAN.md`, rewrite the lamps line: green means working and amber means your turn, and both still go dark after 10 quiet minutes. In the "Log formats can change" hurdle, add that the Roster now says when logs can't be read. Commit subject: `Show whose turn a chat is, and count logs that can't be read`.

---

### Task 4: Tracks mark exactly what the chosen agent hasn't seen, with readable labels

Closes: "The shaded 'new' area follows commit time", "The shaded area in the app always follows the first recorded agent", "Labels can overlap a crossing track".

**Files:**
- Modify: `server/git.ts` (`catchup()` returns `shas`)
- Modify: `src/App.tsx` (`RepoView` owns the agent and the brief, and `CatchUp` takes them as props)
- Modify: `src/Tracks.tsx` (props, and the shading)
- Modify: `src/ui.tsx` (gains `HALO`), `src/Map.tsx` (imports it)
- Test: `test/git.test.ts`

**Interfaces:**
- Produces:
  - `catchup()` also returns `shas: string[]`, every commit in `base..head`, not capped at 50. It is empty when there's no visit on record.
  - `Tracks` props: `{ commits; sessions; seen?: string; fresh: string[]; selected?; onSelect }`. Each commit in `fresh` gets a `var(--color-since)` band, `STEP` wide, centred on its column. The dashed line stays at `seen` when that commit is drawn.
  - `CatchUp` props: `{ repo: Detail; agent: string; typed: string; onType: (v: string) => void; brief?: Brief; error?: string }`. `RepoView` calls `useJson<Brief>` once and passes the result to both `CatchUp` and `Tracks`.
  - `export const HALO = { stroke: 'var(--color-sheet)', strokeWidth: 4, paintOrder: 'stroke', strokeLinejoin: 'round' } as const` in `src/ui.tsx`. Map and Tracks labels spread it.

- [ ] **Step 1: Write the failing test**

```ts
test('the brief lists every commit since the visit', async () => {
  … // seen at commit A, then commits B and C on the branch
  assert.deepEqual((await catchup(repo, 'shas-agent')).shas, [c, b])
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test test/git.test.ts`
Expected: FAIL, because `shas` is undefined.

- [ ] **Step 3: Implement `shas` in `catchup()`**

- [ ] **Step 4: Lift the agent and the brief into `RepoView`, shade `fresh` in `Tracks`, and move `HALO` to `ui.tsx`**

- [ ] **Step 5: Run the checks, and type another agent name in the browser**

Run: `npm test` and `npm run check`. In the browser, typing an agent with an older visit shades more commits, and only those commits. Branch labels stay readable where a track crosses them.

- [ ] **Step 6: Docs and commit**

In `PLAN.md`, delete the three items. Commit subject: `Shade exactly the commits the chosen agent hasn't seen`.

---

### Task 5: Agent and settings panels show what applies here

Closes: "Plugin agents everywhere", "Not read: … managed company settings", "Codex project config".

**Files:**
- Modify: `server/setup.ts` (`setup()`)
- Modify: `src/parts.tsx` (a new `usedHere()`), `src/App.tsx` (`Agents`, `Scope`), `src/Map.tsx` (`leavesOf`)
- Test: `test/setup.test.ts`

**Interfaces:**
- Produces:
  - `setup(repo, home = homedir(), managed = MANAGED)`. `MANAGED` is `C:\Program Files\ClaudeCode\managed-settings.json` on Windows, `/Library/Application Support/ClaudeCode/managed-settings.json` on macOS and `/etc/claude-code/managed-settings.json` elsewhere (code.claude.com/docs/en/managed-settings). It comes last in `sources` as `'managed settings'`, because it overrides the rest. Add `// shortcut: the managed-settings.d folder and registry policies aren't read, add them when a managed PC needs it.`
  - `codex.project: 'applied' | 'ignored' | ''`. When the repo has a `.codex/config.toml` and `trust !== 'trusted'`, its values are left out of `sandbox`, `approval`, `network` and `mcp`, and `project` is `'ignored'`. When there's no file, it is `''`.
  - `usedHere(rows: ReturnType<typeof agentRows>)` in `src/parts.tsx` keeps rows with runs here or `def?.from === 'project'`. Map's `leavesOf` and the Inspector's `Agents` both use it. The Inspector adds `and {n} more from your user settings and plugins, not used here.`

- [ ] **Step 1: Write the failing tests**

```ts
test('managed settings are read, and an untrusted project config is left out', async () => {
  writeFileSync(managed, JSON.stringify({ permissions: { deny: ['Bash(curl:*)'] } }))
  … // repo has .codex/config.toml with sandbox_mode = "danger-full-access"; home config has sandbox_mode = "read-only" and no trust entry
  const s = await setup(repo, home, managed)
  assert.deepEqual(s.claude.rules.at(-1), { from: 'managed settings', mode: '', allow: [], ask: [], deny: ['Bash(curl:*)'], dirs: [] })
  assert.equal(s.codex.sandbox, 'read-only')
  assert.equal(s.codex.project, 'ignored')
  … // add [projects.'<repo>'] trust_level = "trusted" to the home config
  assert.equal((await setup(repo, home, managed)).codex.sandbox, 'danger-full-access')
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test test/setup.test.ts`
Expected: FAIL, because there's no managed rule and `sandbox` is the project's value.

- [ ] **Step 3: Implement it in `server/setup.ts`**

- [ ] **Step 4: Add `usedHere` and use it in `Agents` and the Map. In `Scope`, show `This project's .codex/config.toml is ignored until Codex trusts the project.` when `project === 'ignored'`**

- [ ] **Step 5: Run the checks**

Run: `npm test` and `npm run check`. Existing setup tests that expect the project's Codex values must now mark that project as trusted.

- [ ] **Step 6: Docs and commit**

In `PLAN.md`, delete "Plugin agents everywhere" and "Codex project config". Change "Not read" to: claude.ai connectors, the `managed-settings.d` folder, registry policies and permissions set only on the command line. Commit subject: `Show only what applies to this project in the agent and settings panels`.

---

### Task 6: `omni disable` undoes `enable`

Closes: "`enable` has no undo command … Per-chat refs are never pruned".

**Files:**
- Modify: `server/enable.ts` (a new `disable()`, next to the note constants it reverses)
- Modify: `server/cli.ts` (`disable` command and usage line)
- Test: `test/hook.test.ts`

**Interfaces:**
- Produces: `disable(folder: string): Promise<{ repo: string; changed: string[]; kept: string[] }>`. It does the following:
  - Removes this tool's hook from `.claude/settings.local.json`. Other hooks stay, and the `SessionStart` group goes only when it's empty.
  - Removes each of the four note sections (`AGENTS_NOTE`, `CLAUDE_NOTE`, `TODO_NOTE`, `ORDERS_NOTE`) from `AGENTS.md` and `CLAUDE.md`, but only where the section still reads as `enable` wrote it. Compare with line endings and trailing spaces normalised. An edited section goes into `kept`.
  - Deletes `CLAUDE.md` when what's left is just `@AGENTS.md`.
  - Unsets `alias.omni` and `omni.orders`.
  - Deletes every ref under `refs/omni/` in one `git update-ref --stdin`.
- CLI prints `Turned off catch-up in <repo>, changing: …`, plus `Left alone because you edited them: …` when `kept` isn't empty.

- [ ] **Step 1: Write the failing tests**

```ts
test('disable undoes enable and leaves your own hooks and text', async () => {
  … // fresh repo with AGENTS.md "# House rules\n\nBe kind.\n" and a settings file with hook 'mine'
  await enable(repo, { orders: true })
  await markSeen(repo, 'someone')
  const { kept } = await disable(repo)
  assert.deepEqual(kept, [])
  assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), '# House rules\n\nBe kind.\n')
  assert.ok(!existsSync(join(repo, 'CLAUDE.md')))
  assert.deepEqual(JSON.parse(readFileSync(settings, 'utf8')).hooks.SessionStart.map((g: any) => g.hooks[0].command), ['mine'])
  assert.equal(await git(repo, 'for-each-ref', 'refs/omni'), '')
  assert.equal(await git(repo, 'config', '--get', 'alias.omni').catch(() => ''), '')
})

test("disable leaves a note it didn't write", async () => {
  await enable(repo)
  appendFileSync(join(repo, 'AGENTS.md'), 'Also: our team ticks items on Fridays.\n')
  assert.deepEqual((await disable(repo)).kept, ['AGENTS.md: ## To-do list'])
  assert.match(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), /ticks items on Fridays/)
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test test/hook.test.ts`
Expected: FAIL, because `disable` isn't exported.

- [ ] **Step 3: Implement `disable()` in `server/enable.ts` and the command in `server/cli.ts`**

- [ ] **Step 4: Run the checks**

Run: `npm test` and `npm run check`

- [ ] **Step 5: Docs and commit**

In the README, replace the manual "To turn it off" steps with `node path/to/OmniCodeSpace/server/cli.ts disable --repo path/to/your/repo` and one line on what it leaves. In `PLAN.md`, delete the item. Commit subject: `Add omni disable to undo enable`.

---

### Task 7: Orders can be dismissed, show their signature, and pick a model

Closes: "No Dismiss button for orders … A question that failed to start … waits until the server restarts", "Questions use the tool's default model", and part of the "Orders are untrusted input" hurdle (signatures become visible).

**Files:**
- Modify: `server/orders.ts` (`FORMAT`, `Order`, `listOrders()`, the question auto-start in `checkOrders()`, a new `dismissOrder()`)
- Modify: `server/api.ts` (`write()`: `/orders/dismiss`, which goes through `orderBranch()` and `knownRepo()`)
- Modify: `src/Orders.tsx` (a Dismiss button and the signature line), `src/Runs.tsx` (the Run dialog's model field starts as `order.model`)
- Test: `test/orders.test.ts`

**Interfaces:**
- Produces:
  - `dismissOrder(repo: string, branch: string, sha: string): Promise<void>` runs `git update-ref refs/omni/dismissed/<branch> <sha>`. `listOrders` skips an order whose tip equals its dismissed sha, so a new push brings it back.
  - `Order.model: string`, read from an `Omni-Model:` trailer. The auto-started question passes it to `startRun`, which already validates model names.
  - `Order.signed: string`, from `git log -1 --format=%G?%x1f%GS <sha>`: `Signed by <signer>` for `G`, `Not signed` for `N`, and `Signed, but this PC can't check the signature` otherwise.

- [ ] **Step 1: Write the failing tests**

```ts
test('a dismissed order stays hidden until its sender pushes again', async () => {
  await push('omni/orders/d1', 'Do a thing', 'Omni-To: Claude Code', 'Omni-Status: open')
  … // fetch, find the order, then:
  await dismissOrder(shop, 'omni/orders/d1', order.sha)
  assert.ok(!(await listOrders(shop, repos)).some((o) => o.branch === 'omni/orders/d1'))
  await push('omni/orders/d1', 'Do a thing, again', 'Omni-To: Claude Code', 'Omni-Status: open')
  … // fetch, then the order is listed again
})

test('a question runs with the model its sender named, and unsigned orders say so', async () => {
  await push('omni/orders/q-model', 'Which framework?', 'Omni-To: Claude Code', 'Omni-Status: open', 'Omni-Ask: docs', 'Omni-Model: haiku')
  … // checkOrders with the fake agent, then:
  assert.equal(listRuns().find((r) => r.order?.branch === 'omni/orders/q-model')!.model, 'haiku')
  assert.equal(order.signed, 'Not signed')
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test test/orders.test.ts`
Expected: FAIL, because `dismissOrder` isn't exported and `model` is empty.

- [ ] **Step 3: Implement it in `server/orders.ts` and the route in `server/api.ts`**

- [ ] **Step 4: Show it in `src/Orders.tsx` and `src/Runs.tsx`**

Each order card gets the signature line and a **Dismiss** button. Dismissing posts `/api/orders/dismiss` with the sha the card showed.

- [ ] **Step 5: Run the checks**

Run: `npm test` and `npm run check`

- [ ] **Step 6: Docs and commit**

In the README's orders section, add `Omni-Model:` to the format and describe Dismiss and the signature line. In `PLAN.md`, delete "No Dismiss button" and "Questions use the tool's default model". In the "Orders are untrusted input" hurdle, add that each order shows whether its commit is signed. Commit subject: `Dismiss orders, show their signature, and let questions name a model`.

---

### Task 8: Find repos two folders deep

Closes: "repos are found one folder deep" (the "Only Claude Code and Codex logs are read" half stays until step 10).

**Files:**
- Modify: `server/git.ts` (`findRepos()`)
- Test: `test/git.test.ts`

**Interfaces:**
- Produces: `findRepos(roots)` also looks one level inside each folder that isn't a repo. It skips folders that start with `.`, are named `node_modules`, or end in `.worktrees`. Without that last rule, the app's own run folders would count as repos.

- [ ] **Step 1: Write the failing test**

```ts
test('repos are found two folders deep, but not inside run folders', async () => {
  … // root/top (repo), root/school/lesson1 (repo), root/top.worktrees/run-1 (a worktree, with a .git file), root/node_modules/x (repo)
  assert.deepEqual((await findRepos([root])).map((p) => relative(root, p)).sort(), [join('school', 'lesson1'), 'top'])
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test test/git.test.ts`
Expected: FAIL, because `school/lesson1` is missing.

- [ ] **Step 3: Implement it, and update the shortcut comment to say two levels**

- [ ] **Step 4: Run the checks**

Run: `npm test` and `npm run check`. Then time `/api/repos` against `~/IdeaProjects`, and note it in the commit message if it takes over 100 ms.

- [ ] **Step 5: Docs and commit**

In `PLAN.md`, change the item to "Only Claude Code and Codex logs are read, and repos are found two folders deep." In the README's quick start, say repos are found up to two folders down. Commit subject: `Find repos two folders deep`.

---

### Later, needs the Codex proxy: let Codex questions start by themselves

Closes: "Codex questions wait for a click". This needs a working Codex, and the Headroom proxy on port 8787 was down on 2026-11-03.

- [ ] Start a Codex question from the app, asking it to write a file outside the project and run `git status`. It passes if nothing outside the project changed and the write was refused.
- [ ] If it passed, in `server/orders.ts` drop `o.to === 'Claude Code'` from the auto-start check and remove the Codex note from `listOrders`. Update the test that expects a Codex question to wait, plus the README and `PLAN.md`.
