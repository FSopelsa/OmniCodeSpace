import { useState, type KeyboardEvent } from 'react'
import type { Worktree } from '../server/git.ts'
import type { Session } from '../server/sessions.ts'
import type { Setup } from '../server/setup.ts'
import { AgentInfo, Names, SessionList, agentRows } from './parts.tsx'
import { ago, isLive, modelName, useJson } from './ui.tsx'

type Repo = { name: string; path: string; branch: string; changed: number; sessions: Session[]; worktrees: Worktree[]; instructions: string[] }
type MapData = {
  stack: { languages: { name: string; files: number }[]; manifests: { file: string; dependencies: string[] }[] }
  remotes: { name: string; url: string; only: string[] }[]
}
type Leaf = { id: string; label: string; sub: string; live: boolean }

const HUB = { x: 515, y: 330 }
const TOOL_X = 330
const LEAF_X = 104
// A pale outline behind each label keeps it readable where it crosses a line.
const HALO = { stroke: 'var(--color-sheet)', strokeWidth: 4, paintOrder: 'stroke', strokeLinejoin: 'round' } as const
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function Node({ id, x, y, r, label, sub, live, dim, selected, onSelect, labelAt = 'below' }: { id: string; x: number; y: number; r: number; label: string; sub?: string; live?: boolean; dim?: boolean; selected: string; onSelect: (id: string) => void; labelAt?: 'below' | 'right' }) {
  const key = (e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(id))
  const tx = labelAt === 'right' ? x + r + 8 : x
  const ty = labelAt === 'right' ? y + 4 : y + r + 18
  return (
    <g role="button" tabIndex={0} aria-label={`${label}${sub ? `, ${sub}` : ''}`} aria-pressed={selected === id} onClick={() => onSelect(id)} onKeyDown={key} className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-[5]" opacity={dim ? 0.55 : 1}>
      <circle cx={x} cy={y} r={r} fill={live ? 'var(--color-run)' : 'var(--color-sheet)'} stroke="var(--color-ink)" strokeWidth={selected === id ? 5 : 3} strokeDasharray={dim ? '6 5' : undefined} />
      <text x={tx} y={ty} textAnchor={labelAt === 'right' ? 'start' : 'middle'} fontSize="14" fontWeight="700" fill="var(--color-ink)" {...HALO}>{label}</text>
      {sub && <text x={tx} y={ty + 16} textAnchor={labelAt === 'right' ? 'start' : 'middle'} fontSize="12" fill="var(--color-ink-2)" {...HALO}>{sub}</text>}
    </g>
  )
}

function Branch({ id, y, label, sub, color, leaves, live, dim, selected, onSelect }: { id: string; y: number; label: string; sub: string; color: string; leaves: Leaf[]; live?: boolean; dim?: boolean; selected: string; onSelect: (id: string) => void }) {
  const shown = leaves.slice(0, 4)
  const spread = (i: number) => y + (i - (shown.length - 1) / 2) * 46
  return (
    <g>
      <path d={`M${TOOL_X} ${y}H420L${HUB.x} ${HUB.y}`} fill="none" stroke="var(--color-ink)" strokeWidth="6" opacity={dim ? 0.4 : 1} strokeDasharray={dim ? '10 8' : undefined} />
      {shown.map((leaf, i) => (
        <g key={leaf.id}>
          <path d={`M${TOOL_X} ${y}L200 ${spread(i)}H${LEAF_X}`} fill="none" stroke={color} strokeWidth="4" />
          <Node id={leaf.id} x={LEAF_X} y={spread(i)} r={9} label={cut(leaf.label, 16)} sub={cut(leaf.sub, 18)} live={leaf.live} selected={selected} onSelect={onSelect} labelAt="right" />
        </g>
      ))}
      {leaves.length > 4 && <text x={LEAF_X - 60} y={spread(3) + 34} fontSize="12" fill="var(--color-ink-2)">and {leaves.length - 4} more</text>}
      <Node id={id} x={TOOL_X} y={y} r={20} label={label} sub={sub} live={live} dim={dim} selected={selected} onSelect={onSelect} />
    </g>
  )
}

function counted(sessions: Session[]) {
  const by = new Map<string, number>()
  for (const s of sessions) if (modelName(s)) by.set(modelName(s), (by.get(modelName(s)) ?? 0) + 1)
  return [...by].sort((a, b) => b[1] - a[1])
}

function Panel({ id, repo, setup, map, onSelect }: { id: string; repo: Repo; setup?: Setup; map?: MapData; onSelect: (id: string) => void }) {
  const top = repo.sessions.filter((s) => !s.parent)
  const rows = setup ? agentRows(setup.agents, repo.sessions) : []

  if (id.startsWith('tool:')) {
    const tool = id.slice(5)
    const mine = top.filter((s) => s.tool === tool)
    const scope = tool === 'Codex' ? setup?.codex : setup?.claude
    return (
      <>
        <h2 className="text-xl font-extrabold">{tool}</h2>
        <p className="text-ink-2">{mine.length === 1 ? '1 chat' : `${mine.length} chats`} in this project on this PC{mine[0] && `, last ${ago(mine[0].last)}`}.</p>
        <h3 className="mt-3 font-extrabold">Models used here</h3>
        {counted(mine).length === 0 && <p className="text-ink-2">None recorded yet.</p>}
        <ul className="text-ink-2">{counted(mine).map(([m, n]) => <li key={m}>{m}, {n === 1 ? '1 chat' : `${n} chats`}</li>)}</ul>
        <h3 className="mt-3 font-extrabold">Agents</h3>
        <ul>{rows.filter((r) => r.tool === tool).map((r) => <li key={r.key}><button onClick={() => onSelect(`agent:${r.key}`)} className="underline">{r.name}</button> <span className="text-ink-2">{r.runs.length} runs</span></li>)}</ul>
        {setup && scope && (
          <>
            <h3 className="mt-3 font-extrabold">What it can touch</h3>
            <div className="space-y-1 text-sm">
              {tool === 'Codex' ? (
                <dl className="text-ink-2">
                  <dd>Sandbox: {setup.codex.sandbox || 'its default'}, approvals: {setup.codex.approval || 'not set'}{setup.codex.network && `, network ${setup.codex.network === 'true' ? 'on' : 'off'}`}</dd>
                  <dd>This project: {setup.codex.trust || 'not trusted yet'}</dd>
                </dl>
              ) : (
                <p className="text-ink-2">{setup.claude.rules.length ? `Permission rules from ${setup.claude.rules.map((r) => r.from).join(', ')}.` : 'No permission rules, so it asks before each edit or command.'} The Tracks view lists them in full.</p>
              )}
              <Names items={scope.mcp} label="MCP servers" />
              <Names items={scope.skills} label="skills" />
              <Names items={scope.plugins.map((name) => ({ name, from: 'enabled' }))} label="plugins" />
            </div>
          </>
        )}
        <h3 className="mt-3 font-extrabold">Recent chats</h3>
        <SessionList runs={mine} />
      </>
    )
  }
  if (id.startsWith('agent:')) {
    const row = rows.find((r) => `agent:${r.key}` === id)
    if (!row) return <p className="text-ink-2">That agent isn't here any more.</p>
    return (
      <>
        <h2 className="text-xl font-extrabold">{row.name}</h2>
        <p className="text-ink-2">{row.def ? `${row.def.tool} agent, from ${row.def.from}` : `Built into ${row.tool}, no definition file`}</p>
        <div className="mt-2 text-sm"><AgentInfo def={row.def} runs={row.runs} /></div>
      </>
    )
  }
  if (id === 'local') {
    return (
      <>
        <h2 className="text-xl font-extrabold">Local models</h2>
        <p className="mt-1 text-ink-2">Not connected yet. Step 10 adds a local model through OpenCode and Ollama as a third tool, for coding first. Asset generation can follow the same way.</p>
      </>
    )
  }
  if (id === 'worktrees' || id.startsWith('wt:')) {
    return (
      <>
        <h2 className="text-xl font-extrabold">Worktrees</h2>
        <p className="text-ink-2">Each is a separate folder on its own branch, so agents can work side by side without touching your checkout.</p>
        <ul className="mt-2 text-sm">{repo.worktrees.map((w) => <li key={w.path} className={`border-t border-rule py-1 break-all ${`wt:${w.path}` === id ? 'bg-panel' : ''}`}><b>{w.branch || 'detached'}</b><span className="block text-ink-2">{w.path}</span></li>)}</ul>
      </>
    )
  }
  if (id.startsWith('remote:')) {
    const remote = map?.remotes.find((r) => `remote:${r.name}` === id || id.startsWith(`remote:${r.name}/`))
    if (!remote) return null
    return (
      <>
        <h2 className="text-xl font-extrabold">{remote.name}</h2>
        <p className="break-all text-ink-2">{remote.url}</p>
        <p className="mt-2 text-ink-2">Cloud agents and other machines reach this project through here. Their logs stay where they ran, so what shows here is what they pushed.</p>
        <h3 className="mt-3 font-extrabold">Branches only on {remote.name}</h3>
        {remote.only.length === 0 ? <p className="text-ink-2">None, as of the last fetch.</p> : <ul className="font-mono text-[13px]">{remote.only.map((b) => <li key={b}>{b}</li>)}</ul>}
      </>
    )
  }
  if (id === 'other') {
    return (
      <>
        <h2 className="text-xl font-extrabold">Other machines</h2>
        <p className="mt-1 text-ink-2">Not visible yet. At step 14 each machine pushes a small status ref, and it appears here with its agents, with no server in between.</p>
      </>
    )
  }
  return (
    <>
      <h2 className="text-xl font-extrabold">{repo.name}</h2>
      <p className="text-ink-2">{repo.branch || 'detached'}{repo.changed > 0 && `, ${repo.changed} uncommitted ${repo.changed === 1 ? 'file' : 'files'}`}</p>
      <h3 className="mt-3 font-extrabold">Built with</h3>
      {!map && <p className="text-ink-2">Reading the project</p>}
      {map && map.stack.languages.length === 0 && <p className="text-ink-2">No source files recognised.</p>}
      {map && <p className="text-ink-2">{map.stack.languages.map((l) => `${l.name} (${l.files})`).join(', ')}</p>}
      {map?.stack.manifests.map((m) => (
        <details key={m.file} className="mt-1 text-sm">
          <summary className="cursor-pointer"><span className="font-mono text-[13px]">{m.file}</span>{m.dependencies.length > 0 && `, ${m.dependencies.length} dependencies`}</summary>
          <p className="break-words text-ink-2">{m.dependencies.join(', ') || 'Dependencies in this file are not read yet.'}</p>
        </details>
      ))}
      <h3 className="mt-3 font-extrabold">What agents read here</h3>
      {repo.instructions.length === 0 ? <p className="text-ink-2">No instruction files.</p> : <ul className="text-ink-2">{repo.instructions.map((f) => <li key={f} className="break-all">{f}</li>)}</ul>}
    </>
  )
}

export function MapView({ path }: { path: string }) {
  const q = encodeURIComponent(path)
  const { data: repo, error } = useJson<Repo>(`/api/repo?path=${q}`, 5000)
  const { data: setup } = useJson<Setup>(`/api/setup?path=${q}`)
  const { data: map } = useJson<MapData>(`/api/map?path=${q}`)
  const [selected, setSelected] = useState('repo')
  if (error) return <p className="p-5">{error}</p>
  if (!repo) return <p className="p-5 text-ink-2">Reading {path}</p>

  const top = repo.sessions.filter((s) => !s.parent)
  const rows = setup ? agentRows(setup.agents, repo.sessions) : []
  // Agents from user-level plugins are offered in every project, so only ones defined here or with runs here go on the map.
  const leavesOf = (tool: string): Leaf[] => rows.filter((r) => r.tool === tool && (r.runs.length > 0 || r.def?.from === 'project')).map((r) => ({ id: `agent:${r.key}`, label: r.name, sub: `${r.runs.length} runs`, live: r.runs.some(isLive) }))
  const toolSub = (tool: string) => {
    const models = counted(top.filter((s) => s.tool === tool))
    return models.length ? cut(models[0][0], 26) : 'no chats here yet'
  }
  const others = repo.worktrees.slice(1)
  const remotes = (map?.remotes ?? []).slice(0, 2)

  return (
    <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[1fr_340px]">
      <section className="min-w-0 overflow-x-auto bg-panel lg:overflow-y-auto" aria-label={`Map of ${repo.name}`}>
        <svg viewBox="0 0 1000 660" className="block w-full min-w-[760px]" role="group" aria-label="The project in the middle, with each place that works on it around it. Select a node for details.">
          <defs><pattern id="map-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="var(--color-tile)" /></pattern></defs>
          <rect width="1000" height="660" fill="url(#map-grid)" />
          <rect x="16" y="16" width="450" height="628" fill="var(--color-sheet)" fillOpacity="0.6" stroke="var(--color-ink)" strokeWidth="2" />
          <text x="36" y="48" fontSize="20" fontWeight="800" fill="var(--color-ink)">This PC</text>
          <rect x="566" y="16" width="418" height="300" fill="var(--color-sheet)" fillOpacity="0.6" stroke="var(--color-ink)" strokeWidth="2" />
          <text x="586" y="48" fontSize="20" fontWeight="800" fill="var(--color-ink)">Cloud and remotes</text>
          <rect x="566" y="344" width="418" height="300" fill="var(--color-sheet)" fillOpacity="0.6" stroke="var(--color-ink)" strokeWidth="2" strokeDasharray="8 6" />
          <text x="586" y="376" fontSize="20" fontWeight="800" fill="var(--color-ink)">Other machines</text>

          <Branch id="worktrees" y={100} color="var(--color-a1)" label="Worktrees" sub={others.length === 1 ? '1 beside main' : `${others.length} beside main`} leaves={others.map((w) => ({ id: `wt:${w.path}`, label: w.branch || 'detached', sub: w.path.split(/[\\/]/).pop() ?? '', live: false }))} selected={selected} onSelect={setSelected} />
          <Branch id="tool:Claude Code" y={250} color="var(--color-a2)" label="Claude Code" sub={toolSub('Claude Code')} leaves={leavesOf('Claude Code')} live={top.some((s) => s.tool === 'Claude Code' && isLive(s))} selected={selected} onSelect={setSelected} />
          <Branch id="tool:Codex" y={410} color="var(--color-a3)" label="Codex" sub={toolSub('Codex')} leaves={leavesOf('Codex')} live={top.some((s) => s.tool === 'Codex' && isLive(s))} selected={selected} onSelect={setSelected} />
          <Branch id="local" y={565} color="var(--color-a4)" label="Local models" sub="step 10" leaves={[]} dim selected={selected} onSelect={setSelected} />

          {remotes.length === 0 && <text x="586" y="170" fontSize="14" fill="var(--color-ink-2)">{map ? 'No remote, so cloud agents can’t reach this project.' : ''}</text>}
          {remotes.map((r, i) => {
            const y = 120 + i * 110
            return (
              <g key={r.name}>
                <path d={`M${HUB.x} ${HUB.y}L640 ${y}H740`} fill="none" stroke="var(--color-ink)" strokeWidth="6" />
                {r.only.slice(0, 3).map((b, j) => (
                  <g key={b}>
                    <path d={`M740 ${y}L810 ${y - 36 + j * 36}H850`} fill="none" stroke="var(--color-a1)" strokeWidth="4" />
                    <Node id={`remote:${r.name}/${b}`} x={850} y={y - 36 + j * 36} r={8} label={cut(b, 14)} selected={selected} onSelect={setSelected} labelAt="right" />
                  </g>
                ))}
                <Node id={`remote:${r.name}`} x={740} y={y} r={18} label={r.name} sub={r.only.length ? `${r.only.length} branches only there` : 'nothing new there'} selected={selected} onSelect={setSelected} />
              </g>
            )
          })}
          <path d={`M${HUB.x} ${HUB.y}L640 494H700`} fill="none" stroke="var(--color-ink)" strokeWidth="6" strokeDasharray="10 8" opacity="0.4" />
          <Node id="other" x={720} y={494} r={18} label="Not visible yet" sub="step 14" dim selected={selected} onSelect={setSelected} />

          <g role="button" tabIndex={0} aria-label={`${repo.name}, the project`} aria-pressed={selected === 'repo'} onClick={() => setSelected('repo')} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setSelected('repo'))} className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-[6]">
            <circle cx={HUB.x} cy={HUB.y} r="54" fill="var(--color-ink)" stroke="var(--color-ink)" strokeWidth={selected === 'repo' ? 6 : 0} />
            <text x={HUB.x} y={HUB.y - 2} textAnchor="middle" fontSize="13" fontWeight="800" fill="var(--color-sheet)">{cut(repo.name, 12)}</text>
            <text x={HUB.x} y={HUB.y + 16} textAnchor="middle" fontSize="12" fill="var(--color-sheet)">{cut(repo.branch || 'detached', 15)}</text>
          </g>
        </svg>
      </section>
      <aside className="border-t border-rule p-5 lg:overflow-y-auto lg:border-t-0 lg:border-l" aria-live="polite">
        <Panel id={selected} repo={repo} setup={setup} map={map} onSelect={setSelected} />
      </aside>
    </div>
  )
}
