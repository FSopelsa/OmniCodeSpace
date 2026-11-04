import type { Schedule } from '../server/schedules.ts'
import { dayRows, type RosterSession, type Row } from './roster.ts'
import { describe, nextTime } from './rrule.ts'
import { RunList, RunPanel } from './Runs.tsx'
import { Lamp, ago, clock, isLive, modelName, sessionName, useJson } from './ui.tsx'

type RosterData = { host: string; sessions: RosterSession[]; schedules: Schedule[] }

const W = 1440
const LEFT = 240
const TOP = 40
const ROW = 34
const TOOL_COLOR: Record<string, string> = { 'Claude Code': 'var(--color-a2)', Codex: 'var(--color-a3)' }
const when = (d?: Date) => d?.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function Timetable({ rows, day }: { rows: Row[]; day: Date }) {
  const start = day.getTime()
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
  const x = (t: number) => LEFT + ((t - start) / (end - start)) * (W - LEFT - 20)
  const height = TOP + rows.length * ROW + 12
  const now = Date.now()
  return (
    <div className="overflow-x-auto bg-panel">
      <svg viewBox={`0 0 ${W} ${height}`} className="block w-full min-w-[900px]" role="img" aria-label="Timetable of today. Filled bars are stretches of work, dashed boxes are scheduled runs.">
        {Array.from({ length: 25 }, (_, h) => {
          const at = x(new Date(day.getFullYear(), day.getMonth(), day.getDate(), h).getTime())
          return (
            <g key={h}>
              <path d={`M${at} ${TOP - 8}V${height}`} stroke="var(--color-ink-2)" strokeOpacity={h % 3 ? 0.15 : 0.45} />
              {h % 3 === 0 && h < 24 && <text x={at} y={TOP - 14} textAnchor="middle" fontSize="13" fill="var(--color-ink-2)">{String(h).padStart(2, '0')}</text>}
            </g>
          )
        })}
        {rows.map((row, i) => {
          const y = TOP + i * ROW
          const color = TOOL_COLOR[row.tool] ?? 'var(--color-a4)'
          return (
            <g key={row.key}>
              <text x={16} y={y + 20} fontSize="14" fontWeight="700" fill="var(--color-ink)">{row.name.length > 22 ? `${row.name.slice(0, 21)}…` : row.name}</text>
              <text x={LEFT - 12} y={y + 20} fontSize="12" textAnchor="end" fill="var(--color-ink-2)">{row.project.length > 14 ? `${row.project.slice(0, 13)}…` : row.project}</text>
              {row.bars.map((b, j) => (
                <rect key={j} x={x(b.from)} y={y + 6} width={Math.max(x(b.to) - x(b.from), 3)} height={ROW - 12} fill={color}>
                  <title>{`${sessionName(b.session)}, ${clock(new Date(b.from))} to ${clock(new Date(b.to))}`}</title>
                </rect>
              ))}
              {row.planned.map((t) => (
                <rect key={t} x={x(t)} y={y + 6} width={x(t + 30 * 60_000) - x(t)} height={ROW - 12} fill="var(--color-sheet)" stroke="var(--color-ink)" strokeWidth="1.5" strokeDasharray="5 4">
                  <title>{`${row.name}, scheduled at ${clock(new Date(t))}`}</title>
                </rect>
              ))}
            </g>
          )
        })}
        {now >= start && now < end && (
          <g>
            <path d={`M${x(now)} ${TOP - 8}V${height}`} stroke="var(--color-stop)" strokeWidth="2.5" />
            <text x={x(now) + 6} y={TOP - 14} fontSize="13" fontWeight="800" fill="var(--color-stop)">Now</text>
          </g>
        )}
      </svg>
    </div>
  )
}

function Card({ row }: { row: Row }) {
  const latest = row.sessions[0]
  const models = [...new Set(row.sessions.map(modelName).filter(Boolean))]
  return (
    <li className="border-t border-rule py-3">
      <div className="flex items-baseline gap-2">
        <Lamp on={row.sessions.some(isLive)} label={row.sessions.some(isLive) ? 'Active now' : undefined} />
        <b className="font-extrabold">{row.name}</b>
      </div>
      <div className="pl-5 text-ink-2">
        <p>{row.tool} in {row.project}{latest.branch && <>, on <code className="font-mono text-[13px]">{latest.branch}</code></>}</p>
        <p>{row.sessions.length === 1 ? '1 chat' : `${row.sessions.length} chats`} today, last active {ago(latest.last)}{models.length > 0 && `. ${models.join('; ')}`}</p>
        <ul className="mt-1 text-sm">
          {row.sessions.slice(0, 3).map((s) => (
            <li key={s.log} className="truncate">{sessionName(s)}, {clock(s.spans.at(-1)![0])} to {clock(s.last)}</li>
          ))}
        </ul>
      </div>
    </li>
  )
}

export function Roster({ selected, onSelect }: { selected?: string; onSelect: (id?: string) => void }) {
  const { data, error } = useJson<RosterData>('/api/roster', 5000)
  const now = new Date()
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (error) return <p className="p-5">{error}</p>
  if (!data) return <p className="p-5 text-ink-2">Reading today's sessions</p>
  const rows = dayRows(data.sessions, data.schedules, day)
  const working = rows.filter((r) => r.sessions.length)

  return (
    <div className={`grid min-h-0 grid-cols-1 ${selected ? 'lg:grid-cols-[1fr_440px]' : ''}`}>
    <div className="min-h-0 min-w-0 lg:overflow-y-auto">
      <div className="flex flex-wrap items-baseline gap-x-3 px-5 py-3">
        <h1 className="text-xl font-extrabold">Today</h1>
        <span className="text-ink-2">{day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      </div>

      <RunList selected={selected} onSelect={onSelect} />

      <section className="px-5 pb-4" aria-label="This PC">
        <h2 className="text-lg font-extrabold">This PC <span className="text-sm font-normal text-ink-2">{data.host}, {working.length === 1 ? '1 agent' : `${working.length} agents`} at work today</span></h2>
        {working.length === 0 && <p className="mt-1 text-ink-2">Nothing has run on this PC today yet.</p>}
        <ul className="grid gap-x-8 sm:grid-cols-2 xl:grid-cols-3">{working.map((r) => <Card key={r.key} row={r} />)}</ul>
      </section>

      {rows.length > 0 && <Timetable rows={rows} day={day} />}

      <div className="grid gap-8 px-5 py-5 md:grid-cols-2">
        <section aria-label="Scheduled">
          <h2 className="font-extrabold">Scheduled</h2>
          {data.schedules.length === 0 && <p className="mt-1 text-ink-2">No schedules found.</p>}
          <ul className="mt-1">
            {data.schedules.map((s) => (
              <li key={s.file} className="flex items-baseline gap-2 border-t border-rule py-2">
                <Lamp />
                <span>
                  <b>{s.name}</b>
                  <span className="block text-ink-2">{s.tool}, {describe(s.rule)}{s.active ? `. Next: ${when(nextTime(s.rule, now)) ?? 'not this week'}` : '. Paused'}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-ink-2">Read from Codex automations. Claude's scheduled tasks and Windows Task Scheduler aren't read yet.</p>
        </section>
        <section aria-label="Elsewhere">
          <h2 className="font-extrabold">Cloud and other machines</h2>
          <p className="mt-1 text-ink-2">Their logs stay where they ran, so they don't show here. They'll appear through what they push to git: orders at step 11, other machines at step 14.</p>
        </section>
      </div>
    </div>
    {selected && <RunPanel key={selected} id={selected} onClose={() => onSelect(undefined)} />}
    </div>
  )
}
