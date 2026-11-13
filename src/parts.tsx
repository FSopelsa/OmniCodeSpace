import type { Session } from '../server/sessions.ts'
import type { AgentDef, Named } from '../server/setup.ts'
import { ago, count, modelName, sessionName } from './ui.tsx'

export function SessionList({ runs }: { runs: Session[] }) {
  return (
    <ul className="mt-1 text-sm text-ink-2">
      {runs.slice(0, 8).map((r) => (
        <li key={r.log} className="py-0.5">
          <span className="font-semibold text-ink">{sessionName(r)}</span>, {ago(r.last)}, {modelName(r) || 'model not recorded'}, {count(r.tokens.input + r.tokens.output)} new tokens
        </li>
      ))}
      {runs.length > 8 && <li>and {runs.length - 8} older runs</li>}
    </ul>
  )
}

// Defined agents first, then built-in ones that have no file but have run here, each with its runs.
export function agentRows(defs: AgentDef[], runs: Session[]) {
  const known = new Set(defs.map((d) => d.name))
  const builtIn = [...new Set(runs.map((r) => r.agent).filter((a) => a && !known.has(a)))]
  return [
    ...defs.map((def) => ({ name: def.name, key: `${def.tool}:${def.name}`, tool: def.tool, def, runs: runs.filter((r) => r.agent === def.name && r.tool === def.tool) })),
    ...builtIn.map((name) => {
      const mine = runs.filter((r) => r.agent === name)
      return { name, key: `run:${name}`, tool: mine[0].tool, def: undefined, runs: mine }
    }),
  ]
}

// Agents from your user folder and plugins appear in every repo, so a project shows only its own and the ones that ran there.
export const usedHere = (rows: ReturnType<typeof agentRows>) => rows.filter((r) => r.runs.length > 0 || r.def?.from === 'project')

export function AgentInfo({ def, runs }: { def?: AgentDef; runs: Session[] }) {
  return (
    <>
      {def?.description && <p className="text-ink-2">{def.description}</p>}
      {def && (
        <dl className="mt-1 text-ink-2">
          <dd>Model: {def.model || "the session's"}</dd>
          {def.tool === 'Codex' ? <dd>Sandbox: {def.sandbox || "the session's"}</dd> : <dd className="break-words">Can use: {def.tools.length ? def.tools.join(', ') : 'every tool the session has'}</dd>}
          <dd className="break-all">File: {def.file}</dd>
        </dl>
      )}
      {def?.instructions && (
        <details className="mt-1">
          <summary className="cursor-pointer font-semibold">Instructions</summary>
          <pre className="mt-1 max-h-60 overflow-auto border border-rule p-2 font-mono text-[12px] whitespace-pre-wrap">{def.instructions}</pre>
        </details>
      )}
      <h3 className="mt-2 font-semibold">Runs here</h3>
      {runs.length ? <SessionList runs={runs} /> : <p className="text-ink-2">None on this PC yet.</p>}
    </>
  )
}

export function Names({ items, label }: { items: Named[]; label: string }) {
  if (!items.length) return <p className="text-ink-2">No {label}.</p>
  return (
    <details>
      <summary className="cursor-pointer">{items.length} {label}</summary>
      <ul className="text-ink-2">{items.map((i) => <li key={`${i.from}:${i.name}`} className="break-all">{i.name} <span className="text-[12px]">({i.from})</span></li>)}</ul>
    </details>
  )
}
