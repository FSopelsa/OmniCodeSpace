import { useRef, useState } from 'react'
import type { todo } from '../server/todo.ts'
import { button, post, primary, useJson } from './ui.tsx'

type List = Awaited<ReturnType<typeof todo>>

// The list lives in a file in git, so nobody else sees an edit until it's committed and pushed.
function Reminder({ list, busy, onShare }: { list: List; busy: boolean; onShare: () => void }) {
  const { changed, unpushed, upstream, ahead, remote, branch } = list.share
  if (!changed && !unpushed) return null
  const pushes = ahead + (changed ? 1 : 0)
  const where = upstream
    ? `Sharing pushes ${pushes === 1 ? '1 commit' : `${pushes} commits`} on ${branch} to ${upstream}.`
    : remote
      ? `${branch} isn't on a remote yet, so after the commit, push it once yourself.`
      : 'This repo has no remote, so the list stays on this PC. A commit still keeps its history.'
  return (
    <div role="status" className="mt-4 max-w-2xl border-2 border-wait p-3">
      <p className="font-semibold">{changed ? `Your edits to ${list.file} are only on this PC.` : `${list.file} is committed, but not on ${upstream} yet.`}</p>
      <p className="text-sm text-ink-2">{where}</p>
      <button onClick={onShare} disabled={busy} className={`${primary} mt-2`}>
        {changed ? (upstream ? 'Commit and push' : `Commit ${list.file}`) : 'Push'}
      </button>
    </div>
  )
}

export function TodoView({ path }: { path: string }) {
  const [version, setVersion] = useState(0)
  const { data, error } = useJson<List>(`/api/todo?path=${encodeURIComponent(path)}&v=${version}`, 5000)
  // Keeps the old list on screen while the one after an edit loads.
  const last = useRef<List | undefined>(undefined)
  if (data) last.current = data
  const list = data ?? last.current
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  const act = async (url: string, body: object) => {
    setBusy(true)
    setProblem('')
    try {
      await post(url, { repo: path, ...body })
      return true
    } catch (e: any) {
      setProblem(e.message)
      return false
    } finally {
      setBusy(false)
      setVersion((v) => v + 1)
    }
  }

  if (!list) return <p className="p-5 text-ink-2">{error ?? `Reading ${path}`}</p>
  const open = list.items.filter((i) => !i.done).length

  return (
    <section className="min-w-0 p-5 lg:overflow-y-auto">
      <h1 className="text-xl font-extrabold">To-do</h1>
      <p className="text-ink-2">
        {list.exists ? `${open} open and ${list.items.length - open} done, in ${list.file}. Agents read and update the same file.` : `Nothing yet. The first to-do creates ${list.file} in this project.`}
      </p>
      <Reminder list={list} busy={busy} onShare={() => act('/api/todo/share', {})} />
      {problem && <p role="alert" className="mt-3 max-w-2xl font-semibold text-stop">{problem}</p>}

      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (await act('/api/todo', { op: 'add', text })) setText('')
        }}
        className="mt-4 flex max-w-2xl gap-2"
      >
        <label htmlFor="new-todo" className="sr-only">New to-do</label>
        <input id="new-todo" value={text} maxLength={300} placeholder="What needs doing?" onChange={(e) => setText(e.target.value)} className="min-w-0 flex-1 rounded-sm border border-ink-2 bg-transparent px-2 py-1" />
        <button disabled={busy || !text.trim()} className={primary}>Add</button>
      </form>

      <ul className="mt-3 max-w-2xl">
        {list.items.map((item) => (
          <li key={`${item.line}:${item.text}`} className="flex items-baseline gap-2 border-t border-rule py-1.5">
            <input id={`todo-${item.line}`} type="checkbox" checked={item.done} disabled={busy} onChange={() => act('/api/todo', { op: 'toggle', line: item.line, expect: item.text })} className="size-4 flex-none accent-ink" />
            <label htmlFor={`todo-${item.line}`} className={`min-w-0 flex-1 break-words ${item.done ? 'text-ink-2 line-through' : ''}`}>{item.text}</label>
            <button onClick={() => act('/api/todo', { op: 'remove', line: item.line, expect: item.text })} disabled={busy} aria-label={`Remove ${item.text}`} className={button}>Remove</button>
          </li>
        ))}
      </ul>

      <h2 className="mt-8 font-extrabold">From comments in the code</h2>
      <p className="max-w-2xl text-sm text-ink-2">TODO and FIXME comments in tracked files, read live from git. To change one, edit its comment.</p>
      {list.code.length === 0 && <p className="mt-2 text-ink-2">None found.</p>}
      <ul className="mt-2 max-w-3xl">
        {list.code.map((c) => (
          <li key={`${c.file}:${c.line}`} className="border-t border-rule py-1.5">
            <span className="block font-mono text-[13px] break-all text-ink-2">{c.file}:{c.line} {c.tag}</span>
            <span className="break-words">{c.text}</span>
          </li>
        ))}
      </ul>
      {list.code.length === 200 && <p className="mt-2 text-sm text-ink-2">Showing the first 200.</p>}
    </section>
  )
}
