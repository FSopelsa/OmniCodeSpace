import { useEffect, useRef } from 'react'
import type { Commit } from '../server/git.ts'
import type { Session } from '../server/sessions.ts'
import { layout } from './lanes.ts'

const STEP = 40
const LANE = 48
const PAD = 48
const COLORS = ['var(--color-ink)', 'var(--color-a1)', 'var(--color-a2)', 'var(--color-a3)', 'var(--color-a4)']
const ACTIVE_MS = 10 * 60 * 1000

type Props = {
  commits: Commit[]
  sessions: Session[]
  seen?: string
  selected?: string
  onSelect: (sha: string) => void
}

// shortcut: commits whose parent is older than the 60-commit window just end, draw a stub if that ever confuses.
export function Tracks({ commits, sessions, seen, selected, onSelect }: Props) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.scrollTo({ left: box.current.scrollWidth })
  }, [commits.length])

  const { placed, edges, lanes } = layout(commits)
  const at = new Map(placed.map((p) => [p.sha, p]))
  const px = (x: number) => PAD + x * STEP
  const py = (lane: number) => PAD + lane * LANE
  const width = Math.max(px(placed.length) + 180, 600)
  const height = Math.max(py(lanes) + PAD, 240)
  const seenAt = seen ? at.get(seen) : undefined

  // The newest session on each branch stands at that branch's tip.
  const tips = new Map<string, Session>()
  for (const s of sessions) if (!tips.has(s.branch)) tips.set(s.branch, s)

  // Labels run rightwards, so walking from the newest lets a label step aside for the next one on its lane.
  const nextStart = new Map<number, number>()
  const labels = commits.flatMap((c) => {
    if (!c.refs.length) return []
    const p = at.get(c.sha)!
    const session = c.refs.flatMap((r) => tips.get(r) ?? [])[0]
    const name = session ? session.title || session.tool : ''
    const room = Math.max(c.refs[0].length, name.length + 5) * 7.5
    if (px(p.x) + room > (nextStart.get(p.lane) ?? Infinity)) return []
    nextStart.set(p.lane, px(p.x) - 10)
    return [{ c, p, session, name }]
  })

  return (
    <div ref={box} className="overflow-x-auto bg-panel">
      <svg width="100%" height={height} style={{ minWidth: width }} role="img" aria-label={`Commit tracks, ${commits.length} recent commits across ${lanes} lanes. The same commits are listed below.`}>
        <defs>
          <pattern id="tile" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" fill="none" stroke="var(--color-tile)" />
          </pattern>
        </defs>
        <rect width="100%" height={height} fill="url(#tile)" />
        {seenAt && (
          <g>
            <rect x={px(seenAt.x)} width="100%" height={height} fill="var(--color-since)" />
            <path d={`M${px(seenAt.x)} 0V${height}`} stroke="var(--color-ink)" strokeWidth="1.5" strokeDasharray="5 5" />
          </g>
        )}

        {edges.map((e) => {
          const a = at.get(e.from)!
          const b = at.get(e.to)!
          const [ax, ay, bx, by] = [px(a.x), py(a.lane), px(b.x), py(b.lane)]
          const rise = Math.abs(by - ay)
          // Track diagrams bend at 45 degrees: a branch leaves near its parent, a merge joins near its child.
          const d = rise === 0 || rise >= bx - ax
            ? `M${ax} ${ay}L${bx} ${by}`
            : e.merge
              ? `M${ax} ${ay}H${bx - rise}L${bx} ${by}`
              : `M${ax} ${ay}L${ax + rise} ${by}H${bx}`
          return <path key={`${e.from}-${e.to}`} d={d} fill="none" strokeWidth="5" strokeLinejoin="round" stroke={COLORS[(e.merge ? a.lane : b.lane) % COLORS.length]} />
        })}

        {commits.map((c) => {
          const p = at.get(c.sha)!
          const on = c.sha === selected
          return (
            <g key={c.sha} onClick={() => onSelect(c.sha)} className="cursor-pointer">
              <title>{`${c.sha.slice(0, 7)} ${c.subject}`}</title>
              <circle cx={px(p.x)} cy={py(p.lane)} r={on ? 8 : 5.5} fill={on ? 'var(--color-ink)' : 'var(--color-sheet)'} stroke="var(--color-ink)" strokeWidth="2.5" />
            </g>
          )
        })}

        {labels.map(({ c, p, session, name }) => {
          const live = session && Date.now() - Date.parse(session.last) < ACTIVE_MS
          return (
            <g key={c.sha} fontSize="13">
              <text x={px(p.x)} y={py(p.lane) - 14} fill="var(--color-ink)" fontWeight="700">{c.refs[0]}</text>
              {session && (
                <g>
                  <circle cx={px(p.x) + 22} cy={py(p.lane)} r="8" fill={live ? 'var(--color-run)' : 'var(--color-sheet)'} stroke="var(--color-ink)" strokeWidth="2.5" />
                  <text x={px(p.x) + 36} y={py(p.lane) + 5} fill="var(--color-ink)" fontWeight="700">{name}</text>
                </g>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
