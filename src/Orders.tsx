import { useCallback, useEffect, useState } from 'react'
import type { Order } from '../server/orders.ts'
import { StartDialog } from './Runs.tsx'
import { Lamp, ago, button, clock, post, primary } from './ui.tsx'

type Checked = { checked: string; errors: { project: string; error: string }[]; orders: Order[] }

// A POST, because a check can fetch and start questions, so it needs the page's token.
export function useOrders() {
  const [data, setData] = useState<Checked>()
  const [error, setError] = useState('')
  const check = useCallback(async (now = false) => {
    try {
      setData(await post<Checked>('/api/orders/check', { now }))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    // Opening the page fetches at once: with nothing listed, there's no Check now button.
    check(true)
    const timer = setInterval(() => check(), 60_000)
    return () => clearInterval(timer)
  }, [check])
  return { data, error, check }
}

const LAMP = { open: 'wait', ready: 'wait', running: 'run', blocked: 'off', diverged: 'off' } as const
const STATE: Record<Order['state'], string> = { open: 'Waiting for you to run it', ready: 'Done here, waiting for you to send it back', running: 'Working', blocked: 'Blocked', diverged: 'Diverged' }

export function NeedsYou({ orders, onSelect }: { orders: ReturnType<typeof useOrders>; onSelect: (id: string) => void }) {
  const { data, error, check } = orders
  const [order, setOrder] = useState<Order>()
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  if (!data?.orders.length && !data?.errors.length && !error) return null

  const send = (o: Order) => post('/api/orders/send', { repo: o.repo, branch: o.branch }).then(() => (setProblem(''), check()), (e) => setProblem(e.message))
  const checkNow = async () => {
    setBusy(true)
    await check(true)
    setBusy(false)
  }

  return (
    <section className="px-5 pb-4" aria-label="Needs you">
      <h2 className="text-lg font-extrabold">Needs you</h2>
      <ul className="grid gap-x-8 sm:grid-cols-2 xl:grid-cols-3">
        {data?.orders.map((o) => (
          <li key={`${o.repo}|${o.branch}`} className="border-t border-rule py-3">
            <div className="flex items-baseline gap-2">
              <Lamp state={LAMP[o.state]} label={STATE[o.state]} />
              <span className="min-w-0">
                <b className="block truncate font-extrabold">{o.title}</b>
                <span className="block text-ink-2">{o.project} · from {o.author} · {ago(o.date)}{o.ask && ` · question about ${o.ask}`}</span>
                {o.note && <span className="block text-sm break-words text-ink-2">{o.note}</span>}
              </span>
            </div>
            {o.report && (
              <details className="mt-2 pl-5">
                <summary className="cursor-pointer text-sm font-semibold">Read the report before sending it back</summary>
                <pre className="mt-1 max-h-72 overflow-auto border border-rule p-2 font-mono text-[12px] whitespace-pre-wrap">{o.report}</pre>
              </details>
            )}
            <div className="mt-2 flex gap-2 pl-5">
              {o.state === 'open' && <button onClick={() => setOrder(o)} className={primary}>Run</button>}
              {o.state === 'ready' && <button onClick={() => send(o)} className={primary}>Send back</button>}
              {o.run && <button onClick={() => onSelect(o.run!)} className={button}>Show the run</button>}
            </div>
          </li>
        ))}
      </ul>
      {problem && <p role="alert" className="mt-2 font-semibold text-stop">{problem}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
        {data && <span>Last checked {clock(data.checked)}</span>}
        <button onClick={checkNow} disabled={busy} className={button}>{busy ? 'Checking' : 'Check now'}</button>
      </div>
      {error && <p className="mt-1 text-sm text-stop">{error}</p>}
      {data?.errors.map((e) => <p key={e.project} className="mt-1 text-sm break-words text-ink-2">{e.project}: {e.error}</p>)}
      {order && (
        <StartDialog
          repos={[]}
          order={order}
          onClose={() => setOrder(undefined)}
          onStarted={(run) => {
            setOrder(undefined)
            onSelect(run.id)
            check()
          }}
        />
      )}
    </section>
  )
}
