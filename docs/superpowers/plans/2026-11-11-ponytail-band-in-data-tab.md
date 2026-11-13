# Ponytail Band in the Data Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show ponytail's per-task rows (cost, turns, agent time, tokens, reuse, tests) for the selected project in the Data tab.

**Architecture:** ponytail already writes one CSV per project folder to `~/.config/ponytail/band/`. A new `server/band.ts` reads the CSVs of the project and its worktrees, `/data` returns them as `tasks`, and the Data tab draws one chart with a table of the same rows. OmniCodeSpace only reads; it never writes or changes ponytail's files.

**Tech Stack:** TypeScript on Node 24 (`node:test`), React, Vega-Lite through the existing `Chart.tsx`.

**Spec:** none written. Source: the user's request in the session, and ponytail 5.3.3's column list (`CSV_HEADER` in `~/.claude/plugins/cache/ponytail/ponytail/5.3.3/hooks/band/metrics.ts`).

## Global Constraints

- Read-only: no change to ponytail's files or hooks. Whether ponytail writes a row after every turn is ponytail's behaviour and was not verified here.
- File name: ponytail's rule, every character but letters, digits, `_`, `.` and `-` replaced by `_`, plus `.csv` (`C:\Users\Felix\IdeaProjects\OmniCodeSpace` becomes `C__Users_Felix_IdeaProjects_OmniCodeSpace.csv`). ponytail's import, and its band outside Windows, name the file after the folder name alone, so read that file too. (Corrected after the final review.)
- Header, in order: `key,started,project,name,cost_usd,turns,agent_minutes,tokens_total,tokens_output,reuse_pct,reused,new,callers_open,tests,level,model`.
- `started` is `YYYY-MM-DD HH:MM` in this PC's local time. An empty `cost_usd` means ponytail had no price for the model, so show it as unknown, never as 0.
- `tests` is free text: `not run`, `stale`, or e.g. `74 passed`.
- Colours come from the existing tokens: `--color-run`, `--color-stop`, `--color-wait`, `--chart-other`.
- Follow the README's privacy section: say that task names are read from these files.

## Review Focus

- A task name with a comma, quote or newline inside quotes: one row, name intact.
- Missing file, empty file or header-only file: no tasks, no error.
- A short or garbled row (too few columns, non-numeric cost): skipped, never `NaN` on screen.
- The same `key` in the project's CSV and a worktree's CSV: one row.
- Empty `cost_usd` or `reuse_pct`: `null`, shown as "unknown" or "none", not 0.

---

### Task 1: Read the band CSVs on the server

**Files:**
- Create: `server/band.ts`
- Test: `test/band.test.ts`
- Modify: `server/api.ts` (the `/data` case, around line 62)

**Interfaces:**
- Produces:
  - `type BandTask = { key: string; started: string; name: string; cost: number | null; turns: number; minutes: number; tokens: number; output: number; reuse: number | null; tests: string; level: string; model: string }`
  - `bandFile(folder: string): string` returns the file name only.
  - `readBand(folders: string[], dir?: string): BandTask[]`, `dir` defaulting to `~/.config/ponytail/band`.

- [ ] **Step 1: Write the failing tests in `test/band.test.ts`**
  - `bandFile('C:\\Users\\Felix\\IdeaProjects\\OmniCodeSpace')` equals `'C__Users_Felix_IdeaProjects_OmniCodeSpace.csv'`, and the forward-slash form `'C:/Users/Felix/x'` gives `'C__Users_Felix_x.csv'`.
  - `readBand` on a temp dir holding one CSV with a `"Fix, then ship"` row (cost 7.44, reuse 25, tests `74 passed`) and a row with empty cost and reuse: the first row has `name === 'Fix, then ship'`, `cost === 7.44`, `reuse === 25`; the second has `cost === null`, `reuse === null`.
  - A row with 3 columns and a row with cost `abc` are skipped.
  - The same `key` in two CSVs (two folders) returns once.
  - A missing folder file and a header-only file return `[]`.

- [ ] **Step 2: Run `npm test -- test/band.test.ts`**; expected: FAIL, module not found.

- [ ] **Step 3: Implement `server/band.ts`.** Parse CSV with a small quote-aware loop (doubled `""` is a quote, quoted fields may hold commas and newlines). Map columns by header name, not position. Skip rows whose `key` is empty or whose `turns` or `cost_usd` (when not empty) is not a number. Read each folder's file with `readFileSync` inside try/catch (missing file is `[]`), dedupe by `key` keeping the first, sort by `started`.

- [ ] **Step 4: Return `tasks` from `/data` in `server/api.ts`**: add `tasks: readBand(folders)` to the returned object, where `folders` is the list already built there.

- [ ] **Step 5: Run `npm test` and `npm run check`**; expected: all pass.

### Task 2: Draw the tasks in the Data tab

**Files:**
- Modify: `src/datasets.ts`, `src/Data.tsx`, `README.md`
- Test: `test/datasets.test.ts`

**Interfaces:**
- Consumes: `BandTask` from Task 1, as a type-only import from `../server/band.ts` (the browser must not import its `node:` code).
- Produces: `testState(tests: string): 'passed' | 'failed' | 'stale' | 'not run'`, and `taskRows(tasks: BandTask[], from: number): { at: number; name: string; cost: number | null; turns: number; minutes: number; tokens: number; reuse: number | null; tests: string; state: string }[]`, newest last, only tasks started at or after `from`.

- [ ] **Step 1: Write the failing test in `test/datasets.test.ts`**: `taskRows` drops a task started before `from`, turns `started` `'2026-11-05 01:29'` into the local-time millisecond value `new Date(2026, 10, 5, 1, 29).getTime()`, and sets `state` from `testState`. Also: `testState('74 passed')` is `'passed'`, `'3 failed'` and `'74 passed, 2 failed'` are `'failed'`, `'stale'` is `'stale'`, `'not run'` and `''` are `'not run'`.

- [ ] **Step 2: Run `npm test -- test/datasets.test.ts`**; expected: FAIL, `taskRows` not defined.

- [ ] **Step 3: Implement `testState` and `taskRows` in `src/datasets.ts`.**

- [ ] **Step 4: Add the chart to `src/Data.tsx`**, after "Who commits". Add `tasks: BandTask[]` to the `useJson` type and `tasks: { rows: taskRows(data.tasks, from), spec }` to `charts`. The spec follows `tokenSpec`: a `point` mark, x `at` (temporal), y `cost` (quantitative, title "Cost, USD"), size `minutes`, colour `state` with domain `['passed','failed','stale','not run']` and range `['var(--color-run)','var(--color-stop)','var(--color-wait)','var(--chart-other)']`, tooltip with name, turns, minutes, tokens, reuse, tests. Table columns: Started, Task, Cost (`unknown` when null), Turns, Agent-minutes, Tokens, Reuse (`none` when null, else `25%`), Tests. Title "What each task cost". Note: "From ponytail's band file for this project, ~/.config/ponytail/band. Cost is ponytail's estimate in USD." When `data.tasks` is empty, render one line instead of the chart: "No ponytail band file for this project yet."

- [ ] **Step 5: Add one line to the README** in the Data list and in "Data and privacy" saying the Data tab reads ponytail's band CSV, including task names.

- [ ] **Step 6: Run `npm test` and `npm run check`; then `npm run dev`, open a project with a band file (OmniCodeSpace itself), and confirm the chart and table show its rows**; expected: 11 rows for OmniCodeSpace at All time, the 7.44 and 15.79 rows with their tests status.

- [ ] **Step 7: Tick or add the item in `TODO.md`.** Leave everything uncommitted for review in IntelliJ.
