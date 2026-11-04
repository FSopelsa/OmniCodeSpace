import type { Schedule } from '../server/schedules.ts'
import type { Session } from '../server/sessions.ts'
import { timesOn } from './rrule.ts'

export type RosterSession = Session & { project: string }
export type Row = { key: string; name: string; tool: string; project: string; sessions: RosterSession[]; bars: { from: number; to: number; session: RosterSession }[]; planned: number[] }

// One row per agent per project, or per tool when a chat ran as no particular agent. Times are clipped to the day.
export function dayRows(sessions: RosterSession[], schedules: Schedule[], day: Date): Row[] {
  const start = day.getTime()
  // The next midnight, not start + 24 hours, so days that change clocks still end at midnight.
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
  const rows = new Map<string, Row>()
  for (const session of sessions) {
    const bars = session.spans
      .map(([a, b]) => ({ from: Math.max(Date.parse(a), start), to: Math.min(Date.parse(b), end), session }))
      .filter((bar) => bar.from <= bar.to && bar.to >= start && bar.from < end)
    if (!bars.length) continue
    const name = session.agent || session.tool
    const key = `${name}|${session.tool}|${session.project}`
    const row = rows.get(key) ?? { key, name, tool: session.tool, project: session.project, sessions: [], bars: [], planned: [] }
    row.sessions.push(session)
    row.bars.push(...bars)
    rows.set(key, row)
  }
  const busy = [...rows.values()].sort((a, b) => Math.max(...b.bars.map((x) => x.to)) - Math.max(...a.bars.map((x) => x.to)))
  const planned = schedules.filter((s) => s.active).flatMap((s) => {
    const times = timesOn(s.rule, day).map(Number)
    return times.length ? [{ key: `schedule|${s.file}`, name: s.name, tool: s.tool, project: 'scheduled', sessions: [], bars: [], planned: times }] : []
  })
  return [...busy, ...planned]
}
