import type { BandTask } from '../server/band.ts'
import type { Commit } from '../server/git.ts'
import type { Session } from '../server/sessions.ts'

// Rows for the Data tab's charts, in the browser's own time zone. Each chart and its table show the same rows.

export const DAY = 86_400_000
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const midnight = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }
const monday =(t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime() }

// Uncached tokens are the ones billed at full price: input, cache writes and output. Subagents count, as their tokens are spent too.
// shortcut: all of a session's tokens count on the day it was last active, split them by turn if long sessions skew the days.
export function tokensByDay(sessions: Session[], from: number) {
  const rows = new Map<string, { day: number; tool: string; uncached: number; cached: number }>()
  for (const s of sessions) {
    const last = Date.parse(s.last)
    if (last < from) continue
    const day = midnight(last)
    const row = rows.get(`${day}|${s.tool}`) ?? { day, tool: s.tool, uncached: 0, cached: 0 }
    row.uncached += s.tokens.input + s.tokens.output
    row.cached += s.tokens.cached
    rows.set(`${day}|${s.tool}`, row)
  }
  return [...rows.values()].sort((a, b) => a.day - b.day || a.tool.localeCompare(b.tool))
}

// Agent-minutes per weekday and hour, so two agents working the same hour count twice. Subagents are left out, as they overlap the chat that started them.
export function activityByHour(sessions: Session[], from: number) {
  const cells = new Map<string, { weekday: string; hour: number; minutes: number }>()
  for (const s of sessions) {
    if (s.parent) continue
    for (const [a, b] of s.spans) {
      const end = Date.parse(b)
      for (let t = Math.max(Date.parse(a), from); t < end;) {
        const d = new Date(t)
        const next = Math.min(end, new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime())
        const weekday = DAYS[(d.getDay() + 6) % 7]
        const cell = cells.get(`${weekday}|${d.getHours()}`) ?? { weekday, hour: d.getHours(), minutes: 0 }
        cell.minutes += (next - t) / 60_000
        cells.set(`${weekday}|${d.getHours()}`, cell)
        t = next
      }
    }
  }
  return [...cells.values()].sort((a, b) => DAYS.indexOf(a.weekday) - DAYS.indexOf(b.weekday) || a.hour - b.hour)
}

// A signed commit names its tool first, as in "Claude Code (Opus 5.5), fixing tests".
const who = (c: Commit) => (c.agent ? c.agent.split(/[(,]/)[0].trim() : 'No agent named')

// Commits per week, Monday first. The three busiest names keep their own colour and the rest share "Other".
// They are ranked over all commits, so a shorter range doesn't repaint them.
export function commitsByWeek(commits: Commit[], from: number) {
  const counts = new Map<string, number>()
  for (const c of commits) counts.set(who(c), (counts.get(who(c)) ?? 0) + 1)
  const named = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([name]) => name)
  const names = counts.size > named.length ? [...named, 'Other'] : named
  const rows = new Map<string, { week: number; who: string; commits: number }>()
  for (const c of commits) {
    const t = Date.parse(c.date)
    if (t < from) continue
    const week = monday(t)
    const name = named.includes(who(c)) ? who(c) : 'Other'
    const row = rows.get(`${week}|${name}`) ?? { week, who: name, commits: 0 }
    row.commits++
    rows.set(`${week}|${name}`, row)
  }
  return { names, rows: [...rows.values()].sort((a, b) => a.week - b.week || names.indexOf(a.who) - names.indexOf(b.who)) }
}

// ponytail writes the test result as free text, such as "74 passed", "stale" or "not run".
export const testState = (tests: string) =>
  /fail/i.test(tests.replace(/\b0 failed/gi, '')) ? 'failed' : /pass/i.test(tests) ? 'passed' : /stale/i.test(tests) ? 'stale' : 'not run'

// ponytail's tasks from the start of the range. "started" is this PC's local time, which a date without an offset is read as.
export function taskRows(tasks: BandTask[], from: number) {
  return tasks.flatMap(({ started, name, cost, turns, minutes, tokens, reuse, tests }) => {
    const at = new Date(started.replace(' ', 'T')).getTime()
    return at >= from ? [{ at, name, cost, turns, minutes, tokens, reuse, tests, state: testState(tests) }] : []
  })
}
