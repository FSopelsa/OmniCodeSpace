import { createReadStream, existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'

export type Session = {
  tool: 'Claude Code' | 'Codex'
  id: string
  title: string
  model: string
  cwd: string
  branch: string
  last: string
  tokens: { input: number; cached: number; output: number }
  // The agent definition this run worked as, if any, and the session that started it, for a subagent.
  agent: string
  parent: string
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

export async function readClaude(file: string): Promise<Session> {
  const s: Session = { tool: 'Claude Code', id: '', title: '', model: '', cwd: '', branch: '', last: '', tokens: { input: 0, cached: 0, output: 0 }, agent: '', parent: '' }
  const counted = new Set<string>()
  await eachLine(file, (e) => {
    s.id ||= e.sessionId ?? ''
    // Written when a session starts with --agent.
    if (e.type === 'agent-setting' && e.agentSetting) s.agent = e.agentSetting
    if (e.timestamp && e.timestamp > s.last) s.last = e.timestamp
    if (e.cwd) s.cwd = e.cwd
    if (e.gitBranch) s.branch = e.gitBranch
    if (e.type === 'custom-title' && e.customTitle) s.title = e.customTitle
    if (e.type === 'agent-name' && e.agentName) s.title ||= e.agentName
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
  const s: Session = { tool: 'Codex', id: '', title: '', model: '', cwd: '', branch: '', last: '', tokens: { input: 0, cached: 0, output: 0 }, agent: '', parent: '' }
  await eachLine(file, (e) => {
    if (e.timestamp && e.timestamp > s.last) s.last = e.timestamp
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
    if (e.type === 'turn_context') {
      if (p.model) s.model = p.model
      if (p.cwd) s.cwd = p.cwd
    }
    if (e.type === 'event_msg' && p?.type === 'token_count' && p.info?.total_token_usage) {
      const u = p.info.total_token_usage
      s.tokens = { input: (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0), cached: u.cached_input_tokens ?? 0, output: u.output_tokens ?? 0 }
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
  return results.flatMap((r) => (r.status === 'fulfilled' && r.value.cwd ? [r.value] : [])).sort((a, b) => b.last.localeCompare(a.last))
}

export const normal = (p: string) => p.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()

export function sessionsIn(sessions: Session[], folders: string[]) {
  const roots = folders.map(normal)
  return sessions.filter((s) => {
    const cwd = normal(s.cwd)
    return roots.some((r) => cwd === r || cwd.startsWith(`${r}/`))
  })
}
