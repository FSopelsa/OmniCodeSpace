import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import { NO_HOOKS, git, rev } from './git.ts'

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
}

type Live = { run: Run; key: string; child?: ChildProcess; stopping?: boolean; listeners: Set<() => void>; answer?: (allow: boolean) => void }

// shortcut: runs live in memory, so a server restart forgets them. Their branches, worktrees and tool logs stay. Store them in node:sqlite if that gets in the way.
const runs = new Map<string, Live>()
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
  let e: any
  try {
    e = JSON.parse(line)
  } catch {
    return line.trim() ? [{ kind: 'note', text: short(line) }] : []
  }
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

function update(live: Live, change: Partial<Run> = {}, ...lines: Line[]) {
  if (!lines.length && !Object.keys(change).length) return
  Object.assign(live.run, change)
  live.run.lines.push(...lines)
  for (const listener of live.listeners) listener()
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
  // Awaited when the agent exits, before the run's status changes.
  onEnd?: (run: Run) => Promise<void>
}

export async function startRun(repo: string, opts: StartOptions, api: string, cmd?: [string, string[]]) {
  const { tool, task, model = '', order } = opts
  if (tool !== 'Claude Code' && tool !== 'Codex') throw new Error('Pick Claude Code or Codex.')
  if (!task?.trim() || task.length > 20_000) throw new Error('Describe the task, in under 20,000 characters.')
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

  const run: Run = { id, tool, repo, project: basename(repo), branch, worktree, base, task, model, status: 'running', started: new Date().toISOString(), ended: '', ask: '', lines: [], order }
  const live: Live = { run, key: randomBytes(16).toString('hex'), listeners: new Set() }
  runs.set(id, live)

  const [bin, args] = cmd ?? command(tool, model, Boolean(order?.ask))
  // The agent gets a key that can only ask for approval. Approving needs the page's token, which it isn't given,
  // though any program on this PC can read it from the page, so an agent allowed to run curl could approve itself.
  const env = { ...process.env, ...(process.env.OMNI_PROXY && { ANTHROPIC_BASE_URL: process.env.OMNI_PROXY }), OMNI_API: api, OMNI_RUN: id, OMNI_ASK_KEY: live.key }
  const child = spawn(bin, args, { cwd: opts.cwd ?? worktree, env, windowsHide: true, detached: process.platform !== 'win32' })
  live.child = child
  // If the tool never started, writing the task fails too, and the error event already reports why.
  child.stdin.on('error', () => {})
  child.stdin.end(task)
  createInterface({ input: child.stdout }).on('line', (line) => update(live, {}, ...describe(tool, line)))
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
  if (!live) throw Object.assign(new Error('No such run. Runs are forgotten when the server restarts.'), { status: 404 })
  return live
}

export const listRuns = () => [...runs.values()].map(({ run }) => ({ ...run, lines: [] })).reverse()

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

export async function reviewRun(id: unknown) {
  const { run } = find(id)
  const [commits, status, diff] = await Promise.all([
    git(run.repo, 'log', '--format=%h %s', `${run.base}..${run.branch}`),
    git(run.worktree, 'status', '--short').catch(() => ''),
    git(run.worktree, 'diff', '--no-ext-diff', '--no-color', '--stat', '--patch', run.base).catch(() => ''),
  ])
  return { commits: commits ? commits.split('\n') : [], uncommitted: status ? status.split('\n') : [], diff: diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n\nCut short. Run git diff ${run.base.slice(0, 7)} in the worktree for the rest.` : diff }
}
