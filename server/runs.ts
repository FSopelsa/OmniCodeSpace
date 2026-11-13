import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { NO_HOOKS, git, rev } from './git.ts'
import { withTemplate, type Template } from './templates.ts'

export type Tool = 'Claude Code' | 'Codex'
export type Line = { kind: 'say' | 'tool' | 'error' | 'note'; text: string }
export type Run = {
  id: string
  tool: Tool
  repo: string
  project: string
  branch: string
  worktree: string
  base: string
  task: string
  model: string
  status: 'running' | 'waiting' | 'finished' | 'failed' | 'stopped'
  started: string
  ended: string
  // The command waiting for your approval, while status is "waiting".
  ask: string
  lines: Line[]
  // Set when the run carries out an order from another agent, and ask is set for a question.
  order?: { branch: string; ask: string }
  // The name of the template whose instructions went ahead of the task.
  template?: string
}

type Live = {
  run: Run
  key: string
  // The run's record in the repo's .git/omni/runs, and when it was last written.
  file: string
  saved: number
  // When the agent last printed something, and whether it has been warned about going quiet since.
  quietSince: number
  warned: boolean
  child?: ChildProcess
  stopping?: boolean
  listeners: Set<() => void>
  answer?: (allow: boolean) => void
}

// Each run is also saved to <repo>/.git/omni/runs/<id>.json, so a restart lists it again. Vite reloads this module when a server file changes, so the map and the quiet check live on globalThis.
const kept = globalThis as { omniRuns?: Map<string, Live>; omniQuiet?: NodeJS.Timeout }
const runs = (kept.omniRuns ??= new Map<string, Live>())
kept.omniQuiet ??= setInterval(() => checkQuiet(), 60_000).unref()
const STALL_MS = 10 * 60_000
const GATE = join(import.meta.dirname, 'gate.ts').replaceAll('\\', '/')
const WAIT_MS = 530_000

const short = (text: unknown, max = 200) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

// The Codex desktop app keeps its CLI in a folder per build instead of on PATH.
function codexBin() {
  if (process.env.OMNI_CODEX) return process.env.OMNI_CODEX
  const dir = join(process.env.LOCALAPPDATA ?? '', 'OpenAI', 'Codex', 'bin')
  const builds = existsSync(dir) ? readdirSync(dir).map((b) => join(dir, b, 'codex.exe')).filter(existsSync) : []
  return builds.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? 'codex'
}

export function command(tool: Tool, model: string, readOnly = false): [string, string[]] {
  if (readOnly) {
    // --restricted skips your settings and hooks, and --tools leaves only the three reading tools.
    if (tool === 'Codex') return [codexBin(), ['exec', '--json', '-s', 'read-only', ...(model ? ['-m', model] : []), '-']]
    return [process.env.OMNI_CLAUDE ?? 'claude', ['-p', '--output-format', 'stream-json', '--verbose', '--restricted', '--tools', 'Read,Grep,Glob', '--strict-mcp-config', ...(model ? ['--model', model] : [])]]
  }
  if (tool === 'Codex') {
    // Network off, so a Codex agent can't push. Its sandbox also keeps .git read-only, so its work stays uncommitted for review.
    return [codexBin(), ['exec', '--json', '-s', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=false', ...(model ? ['-m', model] : []), '-']]
  }
  const gate = { hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell|mcp__.*', hooks: [{ type: 'command', command: `node "${GATE}"`, timeout: 600 }] }] } }
  // Committing only touches the run's own branch, and the review needs commits to show.
  const commits = ['Bash(git add:*)', 'Bash(git commit:*)', 'PowerShell(git add:*)', 'PowerShell(git commit:*)']
  return [process.env.OMNI_CLAUDE ?? 'claude', ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', ...commits, '--settings', JSON.stringify(gate), ...(model ? ['--model', model] : [])]]
}

// Turns one line of a tool's JSON output into what the app shows. Lines it doesn't know are skipped.
export function describe(tool: Tool, line: string): Line[] {
  // This runs in a stream handler, where a throw stops the whole server, so any line it can't read becomes a note.
  try {
    return linesOf(tool, JSON.parse(line))
  } catch {
    return line.trim() ? [{ kind: 'note', text: short(line) }] : []
  }
}

function linesOf(tool: Tool, e: any): Line[] {
  if (tool === 'Codex') {
    const item = e.item ?? {}
    if (e.type === 'item.completed' && item.type === 'agent_message') return [{ kind: 'say', text: item.text }]
    if (e.type === 'item.completed' && item.type === 'command_execution') {
      const failed = item.exit_code !== 0 && item.exit_code != null
      return [{ kind: failed ? 'error' : 'tool', text: `${short(item.command)}${failed ? `, exit code ${item.exit_code}` : ''}` }]
    }
    if (e.type === 'item.completed' && item.type === 'file_change') return [{ kind: 'tool', text: `Changed ${(item.changes ?? []).map((c: any) => c.path).join(', ')}` }]
    if (e.type === 'turn.failed' || e.type === 'error') return [{ kind: 'error', text: short(e.error?.message ?? e.message, 600) }]
    return []
  }
  if (e.type === 'system' && e.subtype === 'init') {
    const reads = Array.isArray(e.tools) && e.tools.every((t: string) => ['Read', 'Grep', 'Glob'].includes(t))
    return [{ kind: 'note', text: `Started ${e.model}, ${reads ? 'can only read' : 'edits allowed in this worktree'}` }]
  }
  if (e.type === 'assistant') {
    return (e.message?.content ?? []).flatMap((c: any): Line[] => {
      if (c.type === 'text' && c.text.trim()) return [{ kind: 'say', text: c.text }]
      if (c.type === 'tool_use') return [{ kind: 'tool', text: `${c.name}: ${short(c.input?.command ?? c.input?.file_path ?? c.input?.pattern ?? c.input?.description ?? JSON.stringify(c.input))}` }]
      return []
    })
  }
  if (e.type === 'user') {
    return (e.message?.content ?? []).flatMap((c: any): Line[] => (c.type === 'tool_result' && c.is_error ? [{ kind: 'error', text: short(Array.isArray(c.content) ? c.content.map((x: any) => x.text).join(' ') : c.content) }] : []))
  }
  if (e.type === 'result') {
    const out: Line[] = [{ kind: e.is_error ? 'error' : 'note', text: `Done after ${e.num_turns} turns${e.total_cost_usd ? `, about $${e.total_cost_usd.toFixed(2)} at API prices` : ''}` }]
    const refused = (e.permission_denials ?? []).map((d: any) => short(d.tool_input?.command ?? d.tool_name, 80))
    if (refused.length) out.push({ kind: 'error', text: `Refused by your Claude Code permission rules: ${refused.join('; ')}` })
    return out
  }
  return []
}

function save(live: Live) {
  live.saved = Date.now()
  try {
    mkdirSync(dirname(live.file), { recursive: true })
    // The server's process id, so another copy of the app leaves a run alone while that server still has it.
    writeFileSync(live.file, JSON.stringify({ ...live.run, server: process.pid }))
  } catch {
    // A read-only .git only costs the record. The run carries on.
  }
}

function update(live: Live, change: Partial<Run> = {}, ...lines: Line[]) {
  if (!lines.length && !Object.keys(change).length) return
  Object.assign(live.run, change)
  live.run.lines.push(...lines)
  if (change.status || Date.now() - live.saved > 2000) save(live)
  for (const listener of live.listeners) listener()
}

const STATUSES: Run['status'][] = ['running', 'waiting', 'finished', 'failed', 'stopped']

// shortcut: a reused process id keeps a dead server's run hidden until that process ends too, store a start time with it if that bites.
function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// Adds runs saved by an earlier server. Ones already listed are left alone, so calling it on every poll is cheap. A run another live server is still working on waits until that server ends it.
export async function loadRuns(repos: string[]) {
  for (const repo of repos) {
    const dir = join(repo, '.git', 'omni', 'runs')
    const found: Live[] = []
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      const id = name.slice(0, -'.json'.length)
      if (!name.endsWith('.json') || runs.has(id)) continue
      let record: Run & { server?: number }
      try {
        record = JSON.parse(await readFile(join(dir, name), 'utf8'))
      } catch {
        continue
      }
      const { server, ...run } = record ?? ({} as typeof record)
      // A hand-edited record mustn't break the list, so the fields the app sorts and calls git with are checked.
      if (run.id !== id || !Array.isArray(run.lines) || !STATUSES.includes(run.status) || ![run.started, run.repo, run.worktree, run.branch, run.base].every((v) => typeof v === 'string')) continue
      if ((run.status === 'running' || run.status === 'waiting') && typeof server === 'number' && alive(server)) continue
      found.push({ run, key: randomBytes(16).toString('hex'), file: join(dir, name), saved: 0, quietSince: 0, warned: true, listeners: new Set() })
    }
    for (const live of found.sort((a, b) => String(a.run.started).localeCompare(String(b.run.started)))) {
      runs.set(live.run.id, live)
      if (live.run.status === 'running' || live.run.status === 'waiting') {
        update(live, { status: 'stopped', ask: '' }, { kind: 'note', text: "The server restarted during this run, so its later output isn't shown. Review its branch." })
      }
    }
  }
}

export function checkQuiet(now = Date.now()) {
  for (const live of runs.values()) {
    if (live.run.status !== 'running' || live.warned || now - live.quietSince < STALL_MS) continue
    live.warned = true
    update(live, {}, { kind: 'note', text: "No output for 10 minutes. A tool that can't reach its API waits silently, so use Stop if this goes on." })
  }
}

const slug = (task: string) => task.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32).replace(/-$/, '') || 'task'

type StartOptions = {
  tool: string
  task: string
  model?: string
  // An existing branch to work on, and the commit to start it from when it doesn't exist here yet.
  branch?: string
  from?: string
  // Where the agent runs, when that isn't the worktree.
  cwd?: string
  // A question (order.ask set) always runs read-only.
  order?: Run['order']
  // Instructions the agent gets ahead of the task.
  template?: Template
  // Awaited when the agent exits, before the run's status changes.
  onEnd?: (run: Run) => Promise<void>
}

export async function startRun(repo: string, opts: StartOptions, api: string, cmd?: [string, string[]]) {
  const { tool, task, model = '', order, template } = opts
  if (tool !== 'Claude Code' && tool !== 'Codex') throw new Error('Pick Claude Code or Codex.')
  const input = template && task ? withTemplate(template, task) : task
  if (!task?.trim() || input.length > 20_000) throw new Error(`Describe the task, in under 20,000 characters${template ? ' with the template' : ''}.`)
  // A model name goes on the command line, so it can't look like a flag.
  if (!/^[\w.:/-]*$/.test(model) || model.startsWith('-')) throw new Error('That model name has characters a model name never has.')

  const id = randomBytes(3).toString('hex')
  let base, branch, worktree
  if (opts.branch) {
    branch = opts.branch
    base = await git(repo, 'rev-parse', '--verify', `${opts.from ?? branch}^{commit}`)
    worktree = `${repo}.worktrees/${branch.replaceAll('/', '-')}`
    // An earlier run on this branch leaves its folder, which is used again.
    const reuse = existsSync(worktree) && (await git(worktree, 'branch', '--show-current').catch(() => '')) === branch
    // An existing branch is never reset, so its local commits can't be lost.
    if (!reuse) await git(repo, ...NO_HOOKS, 'worktree', 'add', ...((await rev(repo, `refs/heads/${branch}`)) ? [worktree, branch] : ['-b', branch, worktree, base]))
    // Fast-forward only: picks up what was pushed since, and fails rather than drop a local commit.
    await git(worktree, ...NO_HOOKS, 'merge', '--ff-only', '-q', base)
  } else {
    base = await git(repo, 'rev-parse', '--verify', 'HEAD').catch(() => '')
    if (!base) throw new Error('This repo has no commits yet, so there is nothing to branch from.')
    const name = `${slug(task)}-${id}`
    branch = `omni/${name}`
    worktree = `${repo}.worktrees/${name}`
    await git(repo, 'worktree', 'add', '-b', branch, worktree, base)
  }

  // claude -p uses an API key over your subscription whenever one is set.
  const bills: Line[] = tool === 'Claude Code' ? [{ kind: 'note', text: process.env.ANTHROPIC_API_KEY ? 'Bills your API key, because ANTHROPIC_API_KEY is set.' : 'Uses your Claude Code login.' }] : []
  const run: Run = { id, tool, repo, project: basename(repo), branch, worktree, base, task, model, status: 'running', started: new Date().toISOString(), ended: '', ask: '', lines: bills, order, template: template?.name }
  const live: Live = { run, key: randomBytes(16).toString('hex'), file: join(repo, '.git', 'omni', 'runs', `${id}.json`), saved: 0, quietSince: Date.now(), warned: false, listeners: new Set() }
  runs.set(id, live)
  save(live)

  const [bin, args] = cmd ?? command(tool, model, Boolean(order?.ask))
  // The agent gets a key that can only ask for approval. Approving needs the page's token, which it isn't given,
  // though any program on this PC can read it from the page, so an agent allowed to run curl could approve itself.
  const env = { ...process.env, ...(process.env.OMNI_PROXY && { ANTHROPIC_BASE_URL: process.env.OMNI_PROXY }), OMNI_API: api, OMNI_RUN: id, OMNI_ASK_KEY: live.key }
  const child = spawn(bin, args, { cwd: opts.cwd ?? worktree, env, windowsHide: true, detached: process.platform !== 'win32' })
  live.child = child
  // If the tool never started, writing the task fails too, and the error event already reports why.
  child.stdin.on('error', () => {})
  child.stdin.end(input)
  createInterface({ input: child.stdout }).on('line', (line) => {
    live.quietSince = Date.now()
    live.warned = false
    update(live, {}, ...describe(tool, line))
  })
  let stderr = ''
  child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)))
  // The close event follows, which ends the run, so an order gets its report even then.
  child.on('error', (e) => update(live, {}, { kind: 'error', text: `Couldn't start ${bin}: ${e.message}` }))
  child.on('close', async (code) => {
    live.answer?.(false)
    const status = live.stopping ? 'stopped' : code === 0 ? 'finished' : 'failed'
    const tail: Line[] = status === 'failed' && stderr.trim() ? [{ kind: 'error', text: short(stderr, 1500) }] : []
    const ended = new Date().toISOString()
    try {
      await opts.onEnd?.({ ...live.run, status, ended })
    } catch (e) {
      tail.push({ kind: 'error', text: `After the run: ${short((e as Error).message, 1500)}` })
    }
    update(live, { status, ended, ask: '' }, ...tail)
  })
  return run
}

function find(id: unknown) {
  const live = runs.get(String(id))
  if (!live) throw Object.assign(new Error('No such run.'), { status: 404 })
  return live
}

export const listRuns = () => [...runs.values()].map(({ run }) => ({ ...run, lines: [] })).sort((a, b) => b.started.localeCompare(a.started))

export function stopRun(id: unknown) {
  const live = find(id)
  const pid = live.child?.pid
  if (!pid || live.child?.exitCode !== null) return live.run
  live.stopping = true
  // The agent starts its own processes, so the whole tree goes.
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {})
  else process.kill(-pid, 'SIGTERM')
  return live.run
}

// Called by the gate hook. Resolves when you click, or refuses after about 9 minutes.
export function askRun(id: unknown, key: unknown, command: unknown) {
  const live = find(id)
  if (key !== live.key) throw Object.assign(new Error('Wrong key for this run.'), { status: 403 })
  live.answer?.(false)
  update(live, { status: 'waiting', ask: short(command, 500) })
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => live.answer?.(false), WAIT_MS)
    live.answer = (allow) => {
      clearTimeout(timer)
      live.answer = undefined
      if (live.run.status === 'waiting') update(live, { status: 'running', ask: '' }, { kind: 'note', text: allow ? 'You allowed the push.' : 'The push was refused.' })
      resolve(allow)
    }
  })
}

export function answerRun(id: unknown, allow: boolean) {
  const live = find(id)
  if (!live.answer) throw new Error('This run isn’t waiting for an answer.')
  live.answer(allow)
  return live.run
}

export function watchRun(id: unknown, listener: () => void) {
  const live = find(id)
  live.listeners.add(listener)
  return { run: live.run, stop: () => live.listeners.delete(listener) }
}

const MAX_DIFF = 60_000

// Whether the run's branch would merge into the main checkout's branch, without touching either. Null when the checkout is detached or the check can't run.
async function mergeCheck(run: Run) {
  const into = await git(run.repo, 'branch', '--show-current').catch(() => '')
  if (!into) return null
  // Exit code 1 means conflicts, and stdout then lists them after the tree id.
  const out: string | null = await git(run.repo, 'merge-tree', '--write-tree', '--name-only', '--no-messages', into, run.branch).catch((e) => (e.code === 1 ? String(e.stdout) : null))
  return out === null ? null : { into, conflicts: out.trim().split('\n').slice(1).filter(Boolean) }
}

// Codex can't commit, so the files it adds, such as a reviewer's review.md, are untracked, and plain git diff leaves them out.
async function untracked(worktree: string) {
  const files = (await git(worktree, 'ls-files', '--others', '--exclude-standard').catch(() => '')).split('\n').filter(Boolean)
  // shortcut: the first 20 new files, enough for an agent's report and a few new sources; list the rest if runs add more.
  // --no-index exits 1 when the files differ, which they always do here, so the diff is in the error's stdout.
  const diffs = await Promise.all(files.slice(0, 20).map((f) => git(worktree, 'diff', '--no-index', '--no-ext-diff', '--no-color', '--', '/dev/null', f).catch((e) => String(e.stdout ?? '').trimEnd())))
  return diffs.filter(Boolean).join('\n')
}

export async function reviewRun(id: unknown) {
  const { run } = find(id)
  const [commits, status, tracked, added, merge] = await Promise.all([
    git(run.repo, 'log', '--format=%h %s', `${run.base}..${run.branch}`),
    git(run.worktree, 'status', '--short').catch(() => ''),
    git(run.worktree, 'diff', '--no-ext-diff', '--no-color', '--stat', '--patch', run.base).catch(() => ''),
    untracked(run.worktree),
    mergeCheck(run),
  ])
  const diff = [tracked, added].filter(Boolean).join('\n')
  return { commits: commits ? commits.split('\n') : [], uncommitted: status ? status.split('\n') : [], diff: diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n\nCut short. Run git diff ${run.base.slice(0, 7)} in the worktree for the rest.` : diff, merge }
}

// Removes the run's folder and its record. The branch stays, and git refuses a folder with uncommitted work.
export async function removeRun(id: unknown) {
  const live = find(id)
  const { run } = live
  // Order runs on the same branch share a folder.
  if ([...runs.values()].some(({ run: r }) => r.worktree === run.worktree && (r.status === 'running' || r.status === 'waiting'))) throw new Error('A run is still working in this folder. Stop it first.')
  if (existsSync(run.worktree)) {
    await git(run.repo, 'worktree', 'remove', run.worktree).catch((e) => {
      throw new Error(/modified or untracked/.test(e.message) ? 'The folder has uncommitted changes. Commit or copy what you need, then remove it with git worktree remove --force.' : e.message)
    })
  }
  runs.delete(run.id)
  rmSync(live.file, { force: true })
  return { removed: run.worktree }
}
