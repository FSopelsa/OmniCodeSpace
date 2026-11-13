import { useMemo, useState } from 'react'
import type { BandTask } from '../server/band.ts'
import type { Commit } from '../server/git.ts'
import type { Session } from '../server/sessions.ts'
import { Chart } from './Chart.tsx'
import { DAY, DAYS, activityByHour, commitsByWeek, taskRows, tokensByDay } from './datasets.ts'
import { count, useJson } from './ui.tsx'

const RANGES = [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [0, 'All time']] as const
const WEEK = 7 * DAY
const date = (t: number) => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const midnight = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }
const minutes = (m: number) => count(Math.round(m))

// Bars sit in the middle of their day or week, at most 24px wide.
const bars = (field: string, offset: number, buckets: number, domain: number[]) => ({
  transform: [{ calculate: `datum.${field} + ${offset}`, as: 'middle' }],
  mark: { type: 'bar', width: { expr: `min(24, width / ${buckets} * 0.7)` }, cornerRadiusEnd: 4 },
  x: { field: 'middle', type: 'temporal', title: null, scale: { domain }, axis: { format: '%d %b', grid: false } },
})

function tokenSpec(from: number, to: number) {
  const { transform, mark, x } = bars('day', DAY / 2, (to - from) / DAY, [from, to])
  return {
    width: 'container', height: 220, transform, mark,
    encoding: {
      x,
      y: { field: 'uncached', type: 'quantitative', title: 'Uncached tokens', axis: { labelExpr: "datum.value ? format(datum.value, '~s') : '0'" } },
      color: { field: 'tool', type: 'nominal', scale: { domain: ['Claude Code', 'Codex'], range: ['var(--color-claude)', 'var(--color-a3)'] } },
      tooltip: [
        { field: 'uncached', title: 'Uncached', format: ',' },
        { field: 'cached', title: 'From cache', format: ',' },
        { field: 'tool', title: 'Tool' },
        { field: 'day', type: 'temporal', title: 'Day', format: '%a %d %b' },
      ],
    },
  }
}

const activitySpec = {
  width: 'container', height: { step: 24 }, mark: 'rect',
  encoding: {
    x: { field: 'hour', type: 'ordinal', title: 'Hour', scale: { domain: [...Array(24).keys()] }, axis: { labelAngle: 0 } },
    y: { field: 'weekday', type: 'ordinal', title: null, scale: { domain: DAYS } },
    color: { field: 'minutes', type: 'quantitative', title: 'Agent-minutes' },
    tooltip: [
      { field: 'minutes', title: 'Agent-minutes', format: ',.0f' },
      { field: 'weekday', title: 'Day' },
      { field: 'hour', title: 'Hour' },
    ],
  },
}

function commitSpec(from: number, to: number, names: string[]) {
  const { transform, mark, x } = bars('week', WEEK / 2, (to - from) / WEEK, [from, to])
  return {
    width: 'container', height: 220, transform, mark,
    encoding: {
      x,
      y: { field: 'commits', type: 'quantitative', title: 'Commits', axis: { format: 'd', tickMinStep: 1 } },
      color: { field: 'who', type: 'nominal', scale: { domain: names } },
      order: { field: 'rank' },
      tooltip: [
        { field: 'commits', title: 'Commits' },
        { field: 'who', title: 'Made by' },
        { field: 'week', type: 'temporal', title: 'Week from', format: '%a %d %b' },
      ],
    },
  }
}

const started = (t: number) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// One dot per task: height is cost, size is agent time, colour is the test result. Unknown costs have no dot but stay in the table.
function taskSpec(from: number, to: number) {
  return {
    width: 'container', height: 220, mark: { type: 'circle', opacity: 0.8 },
    transform: [{ filter: 'datum.cost !== null' }],
    encoding: {
      x: { field: 'at', type: 'temporal', title: null, scale: { domain: [from, to] }, axis: { format: '%d %b', grid: false } },
      y: { field: 'cost', type: 'quantitative', title: 'Cost, USD' },
      size: { field: 'minutes', type: 'quantitative', title: 'Agent-minutes', legend: null, scale: { range: [40, 900] } },
      color: { field: 'state', type: 'nominal', scale: { domain: ['passed', 'failed', 'stale', 'not run'], range: ['var(--color-run)', 'var(--color-stop)', 'var(--color-wait)', 'var(--chart-other)'] } },
      tooltip: [
        { field: 'name', title: 'Task' },
        { field: 'cost', title: 'Cost, USD', format: '$.2f' },
        { field: 'turns', title: 'Turns' },
        { field: 'minutes', title: 'Agent-minutes', format: '.1f' },
        { field: 'tokens', title: 'Tokens', format: ',' },
        { field: 'reuse', title: 'Reuse %' },
        { field: 'tests', title: 'Tests' },
        { field: 'at', type: 'temporal', title: 'Started', format: '%a %d %b %H:%M' },
      ],
    },
  }
}

export function DataView({ path }: { path: string }) {
  const { data, error } = useJson<{ commits: Commit[]; sessions: Session[]; tasks: BandTask[] }>(`/api/data?path=${encodeURIComponent(path)}`)
  const [days, setDays] = useState<number>(30)

  const charts = useMemo(() => {
    if (!data) return undefined
    const now = Date.now()
    const today = midnight(now)
    const earliest = Math.min(today, ...data.commits.map((c) => Date.parse(c.date)), ...data.sessions.map((s) => Date.parse(s.spans[0]?.[0] ?? s.last)), ...taskRows(data.tasks, 0).map((t) => t.at))
    const from = days ? today - (days - 1) * DAY : midnight(earliest)
    const end = today + DAY
    const authors = commitsByWeek(data.commits, from)
    // Weeks start on Monday, so the commit axis runs from the Monday on or before the range's first day.
    const weekFrom = midnight(from - ((new Date(from).getDay() + 6) % 7) * DAY)
    return {
      tokens: { rows: tokensByDay(data.sessions, from), spec: tokenSpec(from, end) },
      activity: { rows: activityByHour(data.sessions, from), spec: activitySpec },
      commits: { rows: authors.rows.map((r) => ({ ...r, rank: authors.names.indexOf(r.who) })), spec: commitSpec(weekFrom, weekFrom + Math.ceil((end - weekFrom) / WEEK) * WEEK, authors.names) },
      tasks: taskRows(data.tasks, from),
      from, end,
    }
  }, [data, days])

  if (error) return <p className="p-5">{error}</p>
  if (!charts) return <p className="p-5 text-ink-2">Reading {path}</p>
  return (
    <section className="min-w-0 p-5 lg:overflow-y-auto" aria-label="Charts for this project">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-extrabold">{path.split(/[\\/]/).pop()}</h1>
        <label className="flex items-center gap-2 text-sm font-semibold">
          Range
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-sm border border-ink-2 bg-sheet px-2 py-1 font-normal">
            {RANGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <p className="mt-1 text-sm text-ink-2">From this PC's Claude Code and Codex logs, and the newest 2,000 commits on every branch. Times are in your time zone.</p>
      <div className="max-w-4xl">
        <Chart
          title="Uncached tokens per day"
          note="Input, cache writes and output: the tokens billed at full price. Cache reads are in the tooltip and the table. A session counts on the day it was last active."
          spec={charts.tokens.spec}
          rows={charts.tokens.rows}
          columns={[
            { key: 'day', label: 'Day', show: date },
            { key: 'tool', label: 'Tool' },
            { key: 'uncached', label: 'Uncached', show: count },
            { key: 'cached', label: 'From cache', show: count },
          ]}
        />
        <Chart
          title="When agents work here"
          note="Minutes of agent work in each hour of the week. Two agents working the same hour count twice. Subagents are left out."
          spec={charts.activity.spec}
          rows={charts.activity.rows}
          columns={[
            { key: 'weekday', label: 'Day' },
            { key: 'hour', label: 'Hour' },
            { key: 'minutes', label: 'Agent-minutes', show: minutes },
          ]}
        />
        <Chart
          title="Who commits"
          note="Commits per week, by the agent named in each commit's trailer or co-author line. The three busiest names have their own colour."
          spec={charts.commits.spec}
          rows={charts.commits.rows}
          columns={[
            { key: 'week', label: 'Week from', show: date },
            { key: 'who', label: 'Made by' },
            { key: 'commits', label: 'Commits' },
          ]}
        />
        {charts.tasks.length ? (
          <Chart
            title="What each task cost"
            note="From ponytail's band file for this project, in ~/.config/ponytail/band. Cost is ponytail's estimate in US dollars; a bigger dot is more agent time."
            spec={taskSpec(charts.from, charts.end)}
            rows={charts.tasks}
            columns={[
              { key: 'at', label: 'Started', show: started },
              { key: 'name', label: 'Task' },
              { key: 'cost', label: 'Cost', show: (c: number | null) => (c === null ? 'unknown' : `$${c.toFixed(2)}`) },
              { key: 'turns', label: 'Turns' },
              { key: 'minutes', label: 'Agent-minutes', show: (m: number) => m.toFixed(1) },
              { key: 'tokens', label: 'Tokens', show: count },
              { key: 'reuse', label: 'Reuse', show: (r: number | null) => (r === null ? 'none' : `${r}%`) },
              { key: 'tests', label: 'Tests' },
            ]}
          />
        ) : (
          <p className="mt-8 text-sm text-ink-2">No ponytail tasks for this project in this range. They come from ponytail's band file in ~/.config/ponytail/band.</p>
        )}
      </div>
    </section>
  )
}
