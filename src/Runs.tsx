import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Order } from '../server/orders.ts'
import type { Line, Run, Tool } from '../server/runs.ts'
import type { Template } from '../server/templates.ts'
import { Lamp, ago, button, clock, post, primary, useJson } from './ui.tsx'

type Repo = { name: string; path: string }
type Review = { commits: string[]; uncommitted: string[]; diff: string; merge: { into: string; conflicts: string[] } | null }

const STATUS: Record<Run['status'], string> = { running: 'Working', waiting: 'Waiting for you', finished: 'Finished', failed: 'Failed', stopped: 'Stopped' }
const lampOf = (run: Run) => (run.status === 'waiting' ? 'wait' : run.status === 'running' ? 'run' : 'off')
const code = 'font-mono text-[13px]'

// With an order, the project and the task come from the order.
export function StartDialog({ repos, current, order, onClose, onStarted }: { repos: Repo[]; current?: string; order?: Order; onClose: () => void; onStarted: (run: Run) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [repo, setRepo] = useState(order?.repo ?? current ?? repos[0]?.path ?? '')
  const [tool, setTool] = useState<Tool>(order?.to ?? 'Claude Code')
  const [model, setModel] = useState(order?.model ?? '')
  const [task, setTask] = useState('')
  const [picked, setPicked] = useState('')
  const templates = useJson<Template[]>(order ? null : `/api/templates?path=${encodeURIComponent(repo)}`).data ?? []
  const chosen = templates.find((t) => t.id === picked)
  // A template can suggest a tool and model. They fill the fields, which you can still change.
  // Its model replaces the old one, so a model never outlives the template or tool it belongs to.
  const pick = (id: string) => {
    setPicked(id)
    const t = templates.find((x) => x.id === id)
    if (t?.tool) setTool(t.tool)
    setModel(t?.model ?? '')
  }
  // Model names belong to one tool, such as sonnet to Claude Code, so a new tool starts from its default.
  const switchTool = (t: Tool) => (setTool(t), setModel(''))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const name = order?.project ?? repos.find((r) => r.path === repo)?.name ?? 'the project'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onStarted(await (order ? post<Run>('/api/orders/run', { repo, branch: order.branch, sha: order.sha, tool, model }) : post<Run>('/api/runs', { repo, tool, model, task, template: picked || undefined })))
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="start-title" className="m-auto w-[min(640px,calc(100%-2rem))] border-2 border-ink bg-sheet p-5 text-ink backdrop:bg-black/45">
      <form onSubmit={submit} className="grid gap-3">
        <h2 id="start-title" className="text-xl font-extrabold">{order ? 'Run this order' : 'Start an agent'}</h2>
        {order ? (
          <p><span className="font-semibold">Project</span> {order.project}, from {order.author}</p>
        ) : (
          <label className="grid gap-1 font-semibold">
            Project
            <select value={repo} onChange={(e) => (setRepo(e.target.value), setPicked(''))} className="rounded-sm border border-ink-2 bg-transparent px-2 py-1 font-normal">
              {repos.map((r) => <option key={r.path} value={r.path}>{r.name}</option>)}
            </select>
          </label>
        )}
        {!order && (
          <label className="grid gap-1 font-semibold">
            Template <span className="text-sm font-normal text-ink-2">Instructions the agent gets ahead of your task. A project adds its own in .omni/templates.</span>
            <select value={picked} onChange={(e) => pick(e.target.value)} className="rounded-sm border border-ink-2 bg-transparent px-2 py-1 font-normal">
              <option value="">None</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.from === 'project' ? ' (project)' : ''}</option>)}
            </select>
            {chosen && <span className="text-sm font-normal text-ink-2">{chosen.description}</span>}
          </label>
        )}
        <fieldset className="flex flex-wrap gap-4">
          <legend className="mb-1 font-semibold">Tool</legend>
          {(['Claude Code', 'Codex'] as const).map((t) => (
            <label key={t} className="flex items-center gap-1.5">
              <input type="radio" name="tool" value={t} checked={tool === t} onChange={() => switchTool(t)} /> {t}
            </label>
          ))}
        </fieldset>
        <label className="grid gap-1 font-semibold">
          Model <span className="text-sm font-normal text-ink-2">Leave empty for the tool's default, or write one such as sonnet, haiku or gpt-6.1-terra.</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} className="rounded-sm border border-ink-2 bg-transparent px-2 py-1 font-normal" />
        </label>
        {order ? (
          <div className="grid gap-1">
            <p className="font-semibold">The order, as its sender wrote it</p>
            <pre className="max-h-72 overflow-auto border border-rule p-2 font-mono text-[13px] whitespace-pre-wrap">{order.text}</pre>
          </div>
        ) : (
          <label className="grid gap-1 font-semibold">
            Task
            <textarea required value={task} onChange={(e) => setTask(e.target.value)} rows={5} className="rounded-sm border border-ink-2 bg-transparent px-2 py-1 font-normal" />
          </label>
        )}
        <div className="bg-panel p-3 text-sm">
          <p className="font-semibold">What happens</p>
          {order ? (
            <p>The agent works on the order's own branch, <span className={code}>{order.branch}</span>, in a new folder beside the project: <span className={code}>{name}.worktrees</span>. Your own checkout isn't touched.</p>
          ) : (
            <p>A new branch, <span className={code}>omni/…</span>, starts from {name}'s current commit, in a new folder beside it: <span className={code}>{name}.worktrees</span>. Your own checkout isn't touched.</p>
          )}
          {order?.ask ? (
            <p className="mt-1">This is a question, so {tool} can only read: it works in {order.ask}'s own checkout{tool === 'Claude Code' ? ' with just its Read, Grep and Glob tools' : ', in its read-only sandbox, which can also read outside the project'}. Its answer becomes report.md on the order's branch.</p>
          ) : tool === 'Claude Code' ? (
            <p className="mt-1">Claude Code edits and commits there without asking. Other commands follow your Claude Code permission rules, and any they don't allow are refused. A push waits for your click here.</p>
          ) : (
            <p className="mt-1">Codex works in its workspace-write sandbox with the network off, so it can't push. The sandbox keeps .git read-only, so its changes stay uncommitted for you to review. Codex also marks the project as trusted in your Codex settings.</p>
          )}
          <p className="mt-1">It uses your own {tool} login and usage.</p>
        </div>
        {error && <p role="alert" className="font-semibold text-stop">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => ref.current?.close()} className={button}>Cancel</button>
          <button disabled={busy || !repo} className={primary}>{busy ? 'Starting' : 'Start'}</button>
        </div>
      </form>
    </dialog>
  )
}

export function RunList({ selected, onSelect }: { selected?: string; onSelect: (id: string) => void }) {
  const { data: runs } = useJson<Run[]>('/api/runs', 3000)
  if (!runs?.length) return null
  return (
    <section className="px-5 pb-4" aria-label="Started from here">
      <h2 className="text-lg font-extrabold">Started from here</h2>
      <ul className="grid gap-x-8 sm:grid-cols-2 xl:grid-cols-3">
        {runs.map((r) => (
          <li key={r.id} className="border-t border-rule">
            <button onClick={() => onSelect(r.id)} aria-current={r.id === selected} className={`flex w-full items-baseline gap-2 py-3 text-left ${r.id === selected ? 'bg-panel' : ''}`}>
              <Lamp state={lampOf(r)} />
              <span className="min-w-0">
                <b className="block truncate font-extrabold">{r.task}</b>
                <span className="block text-ink-2">{r.tool} in {r.project}, on <span className={code}>{r.branch}</span></span>
                <span className="block text-ink-2">{STATUS[r.status]}, started {ago(r.started)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

const LINE_STYLE: Record<Line['kind'], string> = { say: 'whitespace-pre-wrap', tool: `${code} text-ink-2 break-all`, error: 'font-semibold text-stop break-words', note: 'text-ink-2' }

export function RunPanel({ id, onClose, onSent }: { id: string; onClose: () => void; onSent?: () => void }) {
  const [run, setRun] = useState<Run>()
  const [lines, setLines] = useState<Line[]>([])
  const [gone, setGone] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState('')
  const end = useRef<HTMLLIElement>(null)

  useEffect(() => {
    const source = new EventSource(`/api/runs/events?id=${encodeURIComponent(id)}`)
    // The server sends every line again after a reconnect.
    source.onopen = () => setLines([])
    source.onmessage = (e) => {
      const message = JSON.parse(e.data)
      if (message.line) setLines((l) => [...l, message.line])
      if (message.run) setRun(message.run)
    }
    source.onerror = () => source.readyState === EventSource.CLOSED && setGone(true)
    return () => source.close()
  }, [id])
  // In braces, because scrollIntoView returns a promise in newer browsers, and React would take that for a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [lines.length])

  const over = run && ['finished', 'failed', 'stopped'].includes(run.status)
  const { data: review } = useJson<Review>(over ? `/api/runs/review?id=${encodeURIComponent(id)}` : null)
  const act = (path: string, body: object) => post(path, { id, ...body }).catch((e) => setError(e.message))
  const remove = () => post('/api/runs/remove', { id }).then(onClose, (e) => setError(e.message))
  const send = (r: Run) => post('/api/orders/send', { repo: r.repo, branch: r.branch }).then(() => (setSent('Sent.'), onSent?.()), (e) => setSent(e.message))

  if (gone) return <aside className="border-t border-rule p-5 lg:border-t-0 lg:border-l">This run is no longer listed. Its branch is still there.</aside>
  if (!run) return <aside className="border-t border-rule p-5 text-ink-2 lg:border-t-0 lg:border-l">Connecting to the run</aside>
  return (
    <aside className="min-h-0 border-t border-rule p-5 lg:overflow-y-auto lg:border-t-0 lg:border-l" aria-label="Run">
      <div className="flex items-start gap-2">
        <h2 className="line-clamp-3 text-xl leading-tight font-extrabold">{run.task}</h2>
        <button onClick={onClose} className={`${button} ml-auto`} aria-label="Close the run">Close</button>
      </div>
      <p className="mt-2 flex items-center gap-2 font-semibold"><Lamp state={lampOf(run)} /> {STATUS[run.status]}</p>
      <dl className="mt-2 text-sm text-ink-2">
        <dd>{run.tool}{run.model && `, ${run.model}`}, in {run.project}{run.template && `, as ${run.template}`}</dd>
        <dd>Branch <span className={code}>{run.branch}</span></dd>
        <dd className="break-all">Folder {run.worktree}</dd>
        <dd>Started {clock(run.started)}{run.ended && `, ended ${clock(run.ended)}`}</dd>
      </dl>

      {run.status === 'waiting' && (
        <div className="mt-3 border-2 border-wait p-3">
          <p className="font-semibold">The agent wants to run:</p>
          <p className={`${code} mt-1 break-all`}>{run.ask}</p>
          <div className="mt-2 flex gap-2">
            <button onClick={() => act('/api/runs/answer', { allow: true })} className={primary}>Allow push</button>
            <button onClick={() => act('/api/runs/answer', { allow: false })} className={button}>Refuse</button>
          </div>
        </div>
      )}
      {(run.status === 'running' || run.status === 'waiting') && (
        <button onClick={() => act('/api/runs/stop', {})} className={`${button} mt-3`}>Stop the agent</button>
      )}
      {error && <p role="alert" className="mt-2 font-semibold text-stop">{error}</p>}

      <h3 className="mt-4 font-extrabold">Output</h3>
      <ol className="mt-1 space-y-1 text-sm" aria-live="polite">
        {lines.map((l, i) => <li key={i} className={LINE_STYLE[l.kind]}>{l.text}</li>)}
        <li ref={end} />
      </ol>

      {review && (
        <>
          <h3 className="mt-4 font-extrabold">Review</h3>
          <p className="text-sm text-ink-2">{review.commits.length === 1 ? '1 commit on the branch' : `${review.commits.length || 'No'} commits on the branch`}{review.uncommitted.length > 0 && `, ${review.uncommitted.length} files not committed`}. {run.order ? 'Send back pushes this branch to origin.' : "Merge or push it yourself once you're happy."}</p>
          {review.merge && (
            <p className={`mt-1 text-sm ${review.merge.conflicts.length ? 'font-semibold' : ''}`}>
              {review.merge.conflicts.length ? `Conflicts with ${review.merge.into} in: ${review.merge.conflicts.join(', ')}. Merge it yourself and decide each one.` : `Merges cleanly into ${review.merge.into}.`}
            </p>
          )}
          <button onClick={remove} className={`${button} mt-2`}>Remove folder</button>
          {run.order && (
            <div className="mt-2 flex items-center gap-2">
              <button onClick={() => send(run)} disabled={sent === 'Sent.'} className={primary}>Send back</button>
              {sent && <span role="status" className={sent === 'Sent.' ? '' : 'font-semibold text-stop'}>{sent}</span>}
            </div>
          )}
          <ul className={`${code} mt-1`}>{review.commits.map((c) => <li key={c}>{c}</li>)}</ul>
          {review.uncommitted.length > 0 && <ul className={`${code} mt-1 text-ink-2`}>{review.uncommitted.map((c) => <li key={c}>{c}</li>)}</ul>}
          {review.diff && <pre className={`${code} mt-2 max-h-96 overflow-auto border border-rule p-2 text-[12px] whitespace-pre`}>{review.diff}</pre>}
        </>
      )}
    </aside>
  )
}
