import { createReadStream, existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'

export type Session = {
  tool: 'Claude Code' | 'Codex'
  id: string
  // One chat can log to two files, when its folder changes partway, so the file is what tells entries apart.
  log: string
  title: string
  model: string
  // Codex logs the reasoning effort with each turn. Claude Code doesn't log it.
  effort: string
  cwd: string
  branch: string
  last: string
  // Stretches of activity, split where the log pauses, for the Roster timetable.
  spans: [string, string][]
  tokens: { input: number; cached: number; output: number }
  // The agent definition this run worked as, if any, and the session that started it, for a subagent.
  agent: string
  parent: string
  // True when the log's last turn ended, or was interrupted, so the chat waits for you.
  turnOver: boolean
  // The plan usage Codex logged most recently in this session.
  limits?: Limits
}

// used is a percentage; resets is in Unix seconds, 0 when unknown.
export type Limit = { used: number; minutes: number; resets: number }
export type Limits = { at: string; windows: Limit[] }

// Codex logs used_percent and Claude Code used_percentage. Out-of-range readings are dropped, never shown as full.
function limit(w: any, minutes: number): Limit[] {
  const used = w?.used_percent ?? w?.used_percentage
  if (typeof used !== 'number' || !(used >= 0 && used <= 100)) return []
  return [{ used, minutes: w.window_minutes > 0 ? w.window_minutes : minutes, resets: w.resets_at > 0 ? w.resets_at : 0 }]
}

// shortcut: both log formats are internal to their tools and can change with any update, so unknown lines are skipped.
async function eachLine(file: string, visit: (entry: any) => void) {
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    try {
      visit(JSON.parse(line))
    } catch {
      // A line still being written, or one that isn't JSON.
    }
  }
}

// A pause longer than this ends one stretch of work. A chat resumed later in the day becomes a second bar, not one long one.
const PAUSE_MS = 15 * 60 * 1000

function track(s: Session, time: string) {
  if (time > s.last) s.last = time
  const span = s.spans.at(-1)
  if (!span || Date.parse(time) - Date.parse(span[1]) > PAUSE_MS) s.spans.push([time, time])
  else if (time > span[1]) span[1] = time
}

const firstText = (content: unknown) => (typeof content === 'string' ? content : Array.isArray(content) ? (content.find((c) => c?.type === 'text')?.text ?? '') : '')

export async function readClaude(file: string): Promise<Session> {
  const s: Session = { tool: 'Claude Code', id: '', log: file, title: '', model: '', effort: '', cwd: '', branch: '', last: '', spans: [], tokens: { input: 0, cached: 0, output: 0 }, agent: '', parent: '', turnOver: false }
  const counted = new Set<string>()
  await eachLine(file, (e) => {
    s.id ||= e.sessionId ?? ''
    // Written when a session starts with --agent.
    if (e.type === 'agent-setting' && e.agentSetting) s.agent = e.agentSetting
    if (e.timestamp) track(s, e.timestamp)
    if (e.cwd) s.cwd = e.cwd
    if (e.gitBranch) s.branch = e.gitBranch
    if (e.type === 'custom-title' && e.customTitle) s.title = e.customTitle
    if (e.type === 'agent-name' && e.agentName) s.title ||= e.agentName
    // Esc logs a user entry, so an interrupted chat waits for you too.
    if (e.type === 'user') s.turnOver = String(firstText(e.message?.content)).startsWith('[Request interrupted')
    if (e.type === 'assistant') s.turnOver = e.message?.stop_reason === 'end_turn'
    if (e.type !== 'assistant' || !e.message?.usage) return
    if (e.message.model && e.message.model !== '<synthetic>') s.model = e.message.model
    // One reply is logged once per content block, each carrying the same usage.
    if (counted.has(e.message.id)) return
    counted.add(e.message.id)
    const u = e.message.usage
    s.tokens.input += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
    s.tokens.cached += u.cache_read_input_tokens ?? 0
    s.tokens.output += u.output_tokens ?? 0
  })
  return s
}

// A subagent's log sits in <session>/subagents/, with a .meta.json beside it naming the agent.
async function readClaudeSubagent(file: string): Promise<Session> {
  const s = await readClaude(file)
  const meta = JSON.parse(await readFile(file.replace(/\.jsonl$/, '.meta.json'), 'utf8').catch(() => '{}'))
  return { ...s, id: basename(file, '.jsonl'), parent: s.id, agent: meta.agentType ?? '', title: meta.description ?? '' }
}

export async function readCodex(file: string, titles: Map<string, string> = new Map()): Promise<Session> {
  const s: Session = { tool: 'Codex', id: '', log: file, title: '', model: '', effort: '', cwd: '', branch: '', last: '', spans: [], tokens: { input: 0, cached: 0, output: 0 }, agent: '', parent: '', turnOver: false }
  await eachLine(file, (e) => {
    if (e.timestamp) track(s, e.timestamp)
    const p = e.payload
    if (e.type === 'session_meta') {
      s.id = p.id ?? ''
      s.cwd = p.cwd ?? ''
      s.branch = p.git?.branch ?? ''
      // A spawned thread names its custom agent as its role, and a null role means Codex's default agent.
      const sub = p.source?.subagent
      if (sub) s.agent = sub.thread_spawn ? (sub.thread_spawn.agent_role ?? 'default') : String(sub.other ?? 'subagent')
      s.parent = p.parent_thread_id ?? sub?.thread_spawn?.parent_thread_id ?? ''
    }
    // Esc logs turn_aborted, which hands the turn back too.
    if (e.type === 'event_msg' && ['task_started', 'task_complete', 'turn_aborted'].includes(p?.type)) s.turnOver = p.type !== 'task_started'
    if (e.type === 'turn_context') {
      if (p.model) s.model = p.model
      if (p.effort) s.effort = p.effort
      if (p.cwd) s.cwd = p.cwd
    }
    if (e.type === 'event_msg' && p?.type === 'token_count' && p.info?.total_token_usage) {
      const u = p.info.total_token_usage
      s.tokens = { input: (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0), cached: u.cached_input_tokens ?? 0, output: u.output_tokens ?? 0 }
    }
    // Other limit ids are separate buckets, not the plan's own windows.
    const rl = p?.type === 'token_count' ? p.rate_limits : undefined
    if (e.type === 'event_msg' && rl && (rl.limit_id ?? 'codex') === 'codex' && e.timestamp) {
      const windows = [...limit(rl.primary, 300), ...limit(rl.secondary, 10080)]
      if (windows.length) s.limits = { at: e.timestamp, windows }
    }
  })
  s.title = titles.get(s.id) ?? ''
  return s
}

async function jsonlFiles(dir: string) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => [])
  return entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => join(e.parentPath, e.name))
}

async function codexTitles(home: string) {
  const titles = new Map<string, string>()
  const index = join(home, '.codex', 'session_index.jsonl')
  if (!existsSync(index)) return titles
  await eachLine(index, (e) => {
    if (e.id && e.thread_name) titles.set(e.id, e.thread_name)
  })
  return titles
}

// What the last scan found: log files, and how many gave no session, which may mean a tool changed its log format.
export let lastScan = { files: 0, unread: 0 }

// Logs reach megabytes, so a file is only parsed again once it has changed.
const cache = new Map<string, { stamp: string; session: Session }>()

export async function allSessions(home = homedir()) {
  const titles = await codexTitles(home)
  const read = async (file: string, parse: (f: string) => Promise<Session>) => {
    const info = await stat(file)
    const stamp = `${info.mtimeMs}:${info.size}`
    const hit = cache.get(file)
    if (hit?.stamp === stamp) return hit.session
    const session = await parse(file)
    cache.set(file, { stamp, session })
    return session
  }
  const [claude, codex] = await Promise.all([jsonlFiles(join(home, '.claude', 'projects')), jsonlFiles(join(home, '.codex', 'sessions'))])
  // allSettled because a tool can delete or rotate a log between listing and reading it.
  const results = await Promise.allSettled([
    ...claude.map((f) => read(f, basename(dirname(f)) === 'subagents' ? readClaudeSubagent : readClaude)),
    ...codex.map((f) => read(f, (x) => readCodex(x, titles))),
  ])
  const sessions = results.flatMap((r) => (r.status === 'fulfilled' && r.value.cwd ? [r.value] : []))
  lastScan = { files: results.length, unread: results.length - sessions.length }
  return sessions.sort((a, b) => b.last.localeCompare(a.last))
}

// The newest Codex reading in any log.
export const codexLimits = (sessions: Session[]) =>
  sessions.reduce<Limits | null>((best, s) => (s.limits && (!best || s.limits.at > best.at) ? s.limits : best), null)

// TokenUsageTracker's status-line bridge keeps the latest Claude Code allowances here. Null when it isn't set up.
export async function claudeLimits(home = homedir()): Promise<Limits | null> {
  const file = join(process.env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'usage-widget', 'usage.json')
  try {
    const data = JSON.parse(await readFile(file, 'utf8'))
    const at = new Date(data.received_at)
    const windows = [...limit(data.rate_limits?.five_hour, 300), ...limit(data.rate_limits?.seven_day, 10080)]
    return isNaN(at.getTime()) || !windows.length ? null : { at: at.toISOString(), windows }
  } catch {
    return null
  }
}

export const normal = (p: string) => p.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()

// Worktrees this app starts sit beside the repo in <repo>.worktrees, so their runs count for that repo.
export function projectOf(cwd: string, repos: string[]) {
  const dir = normal(cwd)
  const repo = repos.find((r) => {
    const root = normal(r)
    return dir === root || dir.startsWith(`${root}/`) || dir.startsWith(`${root}.worktrees/`)
  })
  return basename(repo ?? cwd)
}

export function sessionsIn(sessions: Session[], folders: string[]) {
  const roots = folders.map(normal)
  return sessions.filter((s) => {
    const cwd = normal(s.cwd)
    return roots.some((r) => cwd === r || cwd.startsWith(`${r}/`))
  })
}
