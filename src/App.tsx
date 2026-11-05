import { useState } from 'react'
import type { Commit, Worktree } from '../server/git.ts'
import type { Limits, Session } from '../server/sessions.ts'
import type { AgentDef, Named, Setup } from '../server/setup.ts'
import { DataView } from './Data.tsx'
import { MapView } from './Map.tsx'
import { useOrders } from './Orders.tsx'
import { Roster } from './Roster.tsx'
import { StartDialog } from './Runs.tsx'
import { TodoView } from './Todo.tsx'
import { Tracks } from './Tracks.tsx'
import { AgentInfo, Names, agentRows } from './parts.tsx'
import { Lamp, THEMES, ago, applyTheme, button, count, isLive, modelName, primary, savedTheme, sessionName, useJson, type Theme } from './ui.tsx'

type Summary = { name: string; path: string; branch: string; last: string; changed: number }
type Detail = Summary & {
  commits: Commit[]
  worktrees: Worktree[]
  seen: { agent: string; sha: string }[]
  sessions: Session[]
  instructions: string[]
}
type Brief = { agent: string; seen: string; head: string; commits: number; files: number; briefTokens: number; projectTokens: number; text: string }

function CatchUp({ repo }: { repo: Detail }) {
  const [typed, setTyped] = useState('')
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const agent = typed || repo.seen[0]?.agent || 'me'
  const url = `/api/catchup?path=${encodeURIComponent(repo.path)}&agent=${encodeURIComponent(agent)}`
  const { data, error } = useJson<Brief>(url, 5000)

  const copy = async () => {
    if (!data) return
    await navigator.clipboard.writeText(data.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="px-5 pt-4" aria-label="Catch up an agent">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 font-extrabold">
          Catching up
          <input
            value={typed}
            placeholder={agent}
            list="known-agents"
            onChange={(e) => setTyped(e.target.value)}
            className="w-40 rounded-sm border border-ink-2 bg-transparent px-2 py-0.5 font-normal"
          />
        </label>
        <datalist id="known-agents">{repo.seen.map((s) => <option key={s.agent} value={s.agent} />)}</datalist>
        {error && <span className="text-ink-2">{error}</span>}
        {data && !data.seen && <span className="text-ink-2">No visit on record yet. Run <code className="font-mono text-[13px]">omni seen --agent {agent}</code> to start tracking.</span>}
        {data?.seen && (
          <span className="text-ink-2">
            {data.commits === 0 ? 'Up to date' : `${count(data.commits)} commits and ${count(data.files)} files since ${data.seen.slice(0, 7)}`}. About {count(data.briefTokens)} tokens, against {count(data.projectTokens)} to read every tracked text file.
          </span>
        )}
        <span className="ml-auto flex gap-2">
          <button onClick={() => setOpen(!open)} aria-expanded={open} className="rounded-sm border-[1.5px] border-ink px-3 py-1 text-sm font-semibold">{open ? 'Hide brief' : 'Show brief'}</button>
          <button onClick={copy} disabled={!data} className="rounded-sm border-[1.5px] border-ink px-3 py-1 text-sm font-semibold">{copied ? 'Copied' : 'Copy brief'}</button>
        </span>
      </div>
      {open && data && <pre className="mt-3 max-h-72 overflow-auto border border-rule p-3 font-mono text-[13px] whitespace-pre-wrap">{data.text}</pre>}
    </section>
  )
}

function Agents({ defs, runs }: { defs: AgentDef[]; runs: Session[] }) {
  const [open, setOpen] = useState('')
  const rows = agentRows(defs, runs)

  return (
    <>
      <h2 className="mt-6 font-extrabold">Agents</h2>
      {rows.length === 0 && <p className="mt-1 text-ink-2">No agent definitions for this project, and no agent has run here.</p>}
      <ul className="mt-1">
        {rows.map(({ name, key, def, runs: mine }) => (
            <li key={key} className="border-t border-rule">
              <button onClick={() => setOpen(open === key ? '' : key)} aria-expanded={open === key} className="flex w-full items-baseline gap-2 py-2 text-left">
                <Lamp on={mine.some(isLive)} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{name}</span>
                  <span className="block text-sm text-ink-2">
                    {def ? `${def.tool}, from ${def.from}` : 'Built in, no definition file'}, {mine.length === 1 ? '1 run' : `${mine.length} runs`} here
                  </span>
                </span>
              </button>
              {open === key && (
                <div className="pb-3 pl-5 text-sm">
                  <AgentInfo def={def} runs={mine} />
                </div>
              )}
            </li>
        ))}
      </ul>
    </>
  )
}

function Scope({ setup }: { setup: Setup }) {
  const { claude, codex } = setup
  const rule = (label: string, items: string[]) => items.length > 0 && <dd className="break-all">{label}: {items.join(', ')}</dd>
  return (
    <>
      <h2 className="mt-6 font-extrabold">What agents can touch here</h2>
      <h3 className="mt-2 font-semibold">Claude Code</h3>
      <div className="space-y-1 text-sm">
        {claude.rules.length === 0 && <p className="text-ink-2">No permission rules, so Claude Code asks before each edit or command.</p>}
        {claude.rules.map((r) => (
          <dl key={r.from} className="text-ink-2">
            <dt className="font-semibold text-ink">From {r.from}</dt>
            {r.mode && <dd>Mode: {r.mode}</dd>}
            {rule('Allowed without asking', r.allow)}
            {rule('Always asks', r.ask)}
            {rule('Never allowed', r.deny)}
            {rule('Extra folders', r.dirs)}
          </dl>
        ))}
        <Names items={claude.mcp} label="MCP servers" />
        <Names items={claude.skills} label="skills" />
        <Names items={claude.plugins.map((name) => ({ name, from: 'enabled' }))} label="plugins" />
      </div>
      <h3 className="mt-3 font-semibold">Codex</h3>
      <dl className="text-sm text-ink-2">
        <dd>Sandbox: {codex.sandbox || 'not set, so Codex picks its default'}</dd>
        <dd>Asks for approval: {codex.approval || 'not set'}</dd>
        {codex.network && <dd>Network inside the sandbox: {codex.network === 'true' ? 'on' : 'off'}</dd>}
        <dd>This project: {codex.trust || 'not trusted yet'}</dd>
      </dl>
      <div className="space-y-1 text-sm">
        <Names items={codex.mcp} label="MCP servers" />
        <Names items={codex.skills} label="skills" />
        <Names items={codex.plugins.map((name) => ({ name, from: 'enabled' }))} label="plugins" />
      </div>
      <p className="mt-2 text-[12px] text-ink-2">Read from each tool's settings files. Connectors added in claude.ai and managed company settings aren't included.</p>
    </>
  )
}

function Inspector({ repo, commit }: { repo: Detail; commit?: Commit }) {
  const [openId, setOpenId] = useState('')
  const { data: setup, error } = useJson<Setup>(`/api/setup?path=${encodeURIComponent(repo.path)}`)
  const sessions = repo.sessions.filter((s) => !s.parent)
  return (
    <aside className="border-t border-rule p-5 lg:overflow-y-auto lg:border-t-0 lg:border-l">
      {commit && (
        <div className="mb-6">
          <h2 className="text-xl leading-tight font-extrabold">{commit.subject}</h2>
          <dl className="mt-2 text-ink-2">
            <dd className="font-mono text-[13px]">{commit.sha.slice(0, 12)}</dd>
            <dd>{commit.author}, {ago(commit.date)}</dd>
            {commit.agent && <dd>Agent: {commit.agent}</dd>}
            {commit.why && <dd>Why: {commit.why}</dd>}
          </dl>
        </div>
      )}

      <h2 className="font-extrabold">Sessions here</h2>
      {sessions.length === 0 && <p className="mt-1 text-ink-2">No Claude Code or Codex session has run in this project on this PC yet.</p>}
      <ul className="mt-1">
        {sessions.slice(0, 12).map((s) => (
          <li key={s.log} className="border-t border-rule">
            <button onClick={() => setOpenId(openId === s.log ? '' : s.log)} aria-expanded={openId === s.log} className="flex w-full items-baseline gap-2 py-2 text-left">
              <Lamp on={isLive(s)} />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{sessionName(s)}</span>
                <span className="block text-sm text-ink-2">{s.tool}{s.agent && ` as ${s.agent}`}, {ago(s.last)}</span>
              </span>
            </button>
            {openId === s.log && (
              <dl className="pb-3 pl-5 text-sm text-ink-2">
                <dd>Model: {modelName(s) || 'not recorded'}</dd>
                <dd>Branch: {s.branch || 'not recorded'}</dd>
                <dd className="break-all">Folder: {s.cwd}</dd>
                <dd>Tokens: {count(s.tokens.input)} in, {count(s.tokens.cached)} from cache, {count(s.tokens.output)} out</dd>
              </dl>
            )}
          </li>
        ))}
      </ul>

      {error && <p className="mt-6 text-ink-2">{error}</p>}
      {setup && <Agents defs={setup.agents} runs={repo.sessions} />}
      {setup && <Scope setup={setup} />}

      <h2 className="mt-6 font-extrabold">What agents read here</h2>
      {repo.instructions.length === 0 && <p className="mt-1 text-ink-2">No instruction files in this project.</p>}
      <ul className="mt-1 text-ink-2">{repo.instructions.map((f) => <li key={f} className="break-all">{f}</li>)}</ul>

      <h2 className="mt-6 font-extrabold">Worktrees</h2>
      <ul className="mt-1 text-ink-2">{repo.worktrees.map((w) => <li key={w.path} className="break-all">{w.branch || 'detached'}: {w.path}</li>)}</ul>
    </aside>
  )
}

function RepoView({ path }: { path: string }) {
  const { data: repo, error } = useJson<Detail>(`/api/repo?path=${encodeURIComponent(path)}`, 5000)
  const [sha, setSha] = useState<string>()
  if (error) return <p className="p-5">{error}</p>
  if (!repo) return <p className="p-5 text-ink-2">Reading {path}</p>
  const commit = repo.commits.find((c) => c.sha === sha)
  return (
    <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[1fr_320px]">
      <section className="min-w-0 lg:overflow-y-auto">
        <div className="flex flex-wrap items-baseline gap-x-3 px-5 py-3">
          <h1 className="text-xl font-extrabold">{repo.name}</h1>
          <span className="text-ink-2">
            {repo.branch || 'detached'}{repo.changed > 0 && `, ${repo.changed} uncommitted ${repo.changed === 1 ? 'file' : 'files'}`}
          </span>
        </div>
        {repo.commits.length === 0 ? (
          <p className="bg-panel p-5">This repo has no commits yet. Tracks appear after the first commit.</p>
        ) : (
          <Tracks commits={repo.commits} sessions={repo.sessions.filter((s) => !s.parent)} seen={repo.seen[0]?.sha} selected={sha} onSelect={setSha} />
        )}
        <CatchUp repo={repo} />
        <table className="mx-5 my-3 w-[calc(100%-2.5rem)] border-collapse">
          <tbody>
            {repo.commits.slice(0, 40).map((c) => (
              <tr key={c.sha} className={`border-t border-rule align-baseline ${c.sha === sha ? 'bg-panel' : ''}`}>
                <td className="py-1.5 pr-3 font-mono text-[13px]">
                  <button onClick={() => setSha(c.sha)} aria-label={`Inspect commit ${c.subject}`}>{c.sha.slice(0, 7)}</button>
                </td>
                <td className="py-1.5 pr-3">
                  <span className="line-clamp-2">
                    {c.subject}
                    {c.refs.length > 0 && <span className="ml-2 text-sm text-ink-2">{c.refs.join(', ')}</span>}
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-ink-2">{c.agent || c.author}</td>
                <td className="py-1.5 text-right whitespace-nowrap text-ink-2">{ago(c.date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <Inspector repo={repo} commit={commit} />
    </div>
  )
}

const span = (minutes: number) => (minutes % 1440 ? `${minutes / 60}h` : `${minutes / 1440}d`)
const resetTime = (seconds: number) => new Date(seconds * 1000).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

// What's left of each plan window, as last reported. A window whose reset has passed shows a dash until a new reading arrives.
function PlanLeft() {
  const { data } = useJson<{ codex: Limits | null; claude: Limits | null }>('/api/plan', 60000)
  if (!data) return null
  const now = Date.now() / 1000
  const tool = (name: string, l: Limits | null, missing: string) => (
    <span title={l ? l.windows.map((w) => `${span(w.minutes)} resets ${w.resets ? resetTime(w.resets) : 'at an unknown time'}`).join('. ') : missing}>
      <b>{name}</b>{' '}
      {l ? l.windows.map((w) => `${span(w.minutes)} ${w.resets && w.resets < now ? '—' : `${Math.round(100 - w.used)}%`}`).join(' · ') : 'no reading'}
      {l && now - Date.parse(l.at) / 1000 > 3600 && <span className="text-ink-2">, {ago(l.at)}</span>}
    </span>
  )
  return (
    <p className="flex flex-wrap gap-x-3 text-sm">
      <span className="text-ink-2">Plan left</span>
      {tool('Codex', data.codex, 'No Codex log on this PC has reported plan usage yet.')}
      {tool('Claude', data.claude, "Choose Set up Claude usage in TokenUsageTracker's options, then use Claude Code.")}
    </p>
  )
}

const VIEWS = { tracks: 'Tracks', roster: 'Roster', map: 'Map', todo: 'To-do', data: 'Data' } as const

export function App() {
  const { data, error } = useJson<{ roots: string[]; repos: Summary[] }>('/api/repos', 30000)
  const [path, setPath] = useState<string>()
  const [view, setView] = useState<keyof typeof VIEWS>('tracks')
  const [run, setRun] = useState<string>()
  const [starting, setStarting] = useState(false)
  const [theme, setTheme] = useState(savedTheme)
  const orders = useOrders()
  const waiting = orders.data?.orders.filter((o) => o.state === 'open' || o.state === 'ready').length ?? 0
  const repos = [...(data?.repos ?? [])].sort((a, b) => b.last.localeCompare(a.last))
  const current = path ?? repos[0]?.path

  return (
    <div className="grid min-h-screen grid-rows-[auto_1fr] lg:h-screen">
      <header className="flex min-h-[52px] flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule px-5 py-2">
        <b className="text-lg font-extrabold tracking-tight">OmniCodeSpace</b>
        <nav aria-label="Views" className="flex gap-1">
          {Object.entries(VIEWS).map(([key, label]) => (
            <button key={key} onClick={() => setView(key as keyof typeof VIEWS)} aria-current={view === key ? 'page' : undefined} className={`rounded-sm px-3 py-1 font-semibold ${view === key ? 'bg-ink text-sheet' : ''}`}>
              {label}
            </button>
          ))}
        </nav>
        <PlanLeft />
        {waiting > 0 && <button onClick={() => setView('roster')} className={`${primary} ml-auto`}>Needs you · {waiting}</button>}
        <button onClick={() => setStarting(true)} disabled={!repos.length} className={`${button} ${waiting > 0 ? '' : 'ml-auto'}`}>Start an agent</button>
        <label className="flex items-center gap-2 text-sm font-semibold">
          Theme
          <select
            value={theme}
            onChange={(e) => {
              const picked = e.target.value as Theme
              setTheme(picked)
              applyTheme(picked, true)
            }}
            className="rounded-sm border border-ink-2 bg-sheet px-2 py-1 font-normal"
          >
            {Object.entries(THEMES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </header>
      {starting && (
        <StartDialog
          repos={repos}
          current={current}
          onClose={() => setStarting(false)}
          onStarted={(started) => {
            setStarting(false)
            setRun(started.id)
            setView('roster')
          }}
        />
      )}
      {view === 'roster' ? <Roster selected={run} onSelect={setRun} orders={orders} /> : (
      <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Projects" className="border-b border-rule p-4 lg:overflow-y-auto lg:border-r lg:border-b-0">
          <h2 className="font-extrabold">This PC</h2>
          {error && <p className="mt-2">{error}</p>}
          {data && repos.length === 0 && <p className="mt-2 text-ink-2">No git repos in {data.roots.join(', ')}. Set OMNI_ROOTS to the folders that hold your projects.</p>}
          <ul className="mt-1">
            {repos.map((r) => (
              <li key={r.path}>
                <button
                  onClick={() => setPath(r.path)}
                  aria-current={r.path === current}
                  className={`w-full truncate rounded-sm px-2 py-1 text-left ${r.path === current ? 'bg-panel font-bold' : ''}`}
                >
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        {!current ? <div /> : view === 'map' ? <MapView key={current} path={current} /> : view === 'todo' ? <TodoView key={current} path={current} /> : view === 'data' ? <DataView key={current} path={current} /> : <RepoView key={current} path={current} />}
      </div>
      )}
    </div>
  )
}
