import { useEffect, useState } from 'react'
import type { Session } from '../server/sessions.ts'

export function useJson<T>(url: string | null, every = 0) {
  const [state, setState] = useState<{ url?: string; data?: T; error?: string }>({})
  useEffect(() => {
    if (!url) return
    let alive = true
    const load = () =>
      fetch(url)
        .then(async (r) => {
          const body = await r.json()
          if (alive) setState(r.ok ? { url, data: body } : { url, error: body.error })
        })
        .catch(() => alive && setState({ url, error: 'The local server is not responding. Start it with npm run dev.' }))
    load()
    const timer = every ? setInterval(load, every) : undefined
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [url, every])
  return state.url === url ? state : {}
}

const words = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
export function ago(date: string) {
  if (!date) return ''
  const minutes = Math.round((Date.parse(date) - Date.now()) / 60000)
  if (minutes > -60) return words.format(minutes, 'minute')
  if (minutes > -1440) return words.format(Math.round(minutes / 60), 'hour')
  return words.format(Math.round(minutes / 1440), 'day')
}
export const clock = (date: Date | string) => new Date(date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
export const count = (n: number) => n.toLocaleString('en')
export const isLive = (s: Session) => Date.now() - Date.parse(s.last) < 10 * 60 * 1000
export const sessionName = (s: Session) => s.title || `Session ${s.id.slice(0, 8)}`
export const modelName = (s: Pick<Session, 'model' | 'effort'>) => (s.effort ? `${s.model}, ${s.effort}` : s.model)

const LAMPS = { run: 'bg-run shadow-[0_0_7px_var(--color-run)]', wait: 'bg-wait shadow-[0_0_7px_var(--color-wait)]', off: 'bg-sheet' }
export function Lamp({ on, state = on ? 'run' : 'off', label }: { on?: boolean; state?: keyof typeof LAMPS; label?: string }) {
  return <i role={label ? 'img' : undefined} aria-label={label} className={`inline-block size-3 flex-none rounded-full border-2 border-ink ${LAMPS[state]}`} />
}

// Writes carry the token that the dev server put into the page, so other sites and processes can't start or approve anything.
const token = () => document.querySelector<HTMLMetaElement>('meta[name="omni-token"]')?.content ?? ''
export async function post<T = unknown>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-omni-token': token() }, body: JSON.stringify(body) })
  const json = await r.json()
  if (!r.ok) throw new Error(json.error)
  return json
}

export const button = 'rounded-sm border-[1.5px] border-ink px-3 py-1 text-sm font-semibold disabled:opacity-50'
export const primary = `${button} bg-ink text-sheet`
