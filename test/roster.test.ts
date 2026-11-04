import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { schedules } from '../server/schedules.ts'
import { dayRows, type RosterSession } from '../src/roster.ts'
import { describe, nextTime, timesOn } from '../src/rrule.ts'

const home = mkdtempSync(join(tmpdir(), 'omni-roster-'))
after(() => rmSync(home, { recursive: true, force: true }))

// Tuesday 3 November 2026, local time.
const tuesday = new Date(2026, 10, 3)
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 10, 3 + dayOffset, h, m).toISOString()

test('reads the schedule rules Codex writes', () => {
  const friday = 'RRULE:FREQ=WEEKLY;BYDAY=FR;BYHOUR=9;BYMINUTE=0'
  assert.deepEqual(timesOn(friday, tuesday), [])
  assert.deepEqual(timesOn(friday, new Date(2026, 10, 6)), [new Date(2026, 10, 6, 9, 0)])
  assert.deepEqual(nextTime(friday, new Date(2026, 10, 3, 12)), new Date(2026, 10, 6, 9, 0))
  assert.deepEqual(nextTime(friday, new Date(2026, 10, 6, 9, 0)), new Date(2026, 10, 13, 9, 0))
  assert.equal(describe(friday), 'Fridays at 09:00')

  assert.deepEqual(timesOn('RRULE:FREQ=DAILY;BYHOUR=7,19;BYMINUTE=30', tuesday), [new Date(2026, 10, 3, 7, 30), new Date(2026, 10, 3, 19, 30)])
  assert.equal(timesOn('FREQ=HOURLY;BYMINUTE=15', tuesday).length, 24)
  assert.equal(describe('FREQ=HOURLY;BYMINUTE=15'), 'Every hour at :15')
  // Rules it can't read give no times rather than wrong ones.
  assert.deepEqual(timesOn('RRULE:FREQ=MONTHLY;BYMONTHDAY=3', tuesday), [])
  assert.deepEqual(timesOn('RRULE:FREQ=WEEKLY', tuesday), [])
})

test('finds Codex automations and skips folders without a rule', async () => {
  const dir = join(home, '.codex', 'automations')
  mkdirSync(join(dir, 'report'), { recursive: true })
  mkdirSync(join(dir, 'broken'))
  writeFileSync(join(dir, 'report', 'automation.toml'), 'version = 1\nname = "Friday report"\nstatus = "ACTIVE"\nrrule = "RRULE:FREQ=WEEKLY;BYDAY=FR;BYHOUR=9;BYMINUTE=0"\nprompt = """\nWrite it\n"""\n')
  writeFileSync(join(home, '.codex', 'automations', '.run-jitter-salt'), 'x')
  const found = await schedules(home)
  assert.deepEqual(found.map((s) => [s.name, s.active, s.tool]), [['Friday report', true, 'Codex']])
  assert.deepEqual(await schedules(join(home, 'nobody')), [])
})

const session = (over: Partial<RosterSession>): RosterSession => ({
  tool: 'Claude Code', id: 'x', log: '', title: '', model: '', effort: '', cwd: '', branch: '', last: '', spans: [], tokens: { input: 0, cached: 0, output: 0 }, agent: '', parent: '', project: 'shop', ...over,
})

test("today's rows group by agent and project, and clip work to the day", () => {
  const rows = dayRows(
    [
      session({ id: 'late', agent: 'builder', last: at(14), spans: [[at(9), at(10)], [at(13), at(14)]] }),
      session({ id: 'overnight', last: at(1), spans: [[at(23, 0, -1), at(1)]] }),
      session({ id: 'other-project', last: at(8), project: 'web', spans: [[at(8), at(8)]] }),
      session({ id: 'yesterday', last: at(20, 0, -1), spans: [[at(19, 0, -1), at(20, 0, -1)]] }),
      session({ id: 'same-agent', agent: 'builder', last: at(11), spans: [[at(11), at(11)]] }),
    ],
    [
      { tool: 'Codex', name: 'Nightly', rule: 'FREQ=DAILY;BYHOUR=22', active: true, file: 'a' },
      { tool: 'Codex', name: 'Paused', rule: 'FREQ=DAILY;BYHOUR=22', active: false, file: 'b' },
    ],
    tuesday,
  )
  // The most recently busy row comes first, and scheduled-only rows last.
  assert.deepEqual(rows.map((r) => [r.name, r.project, r.sessions.map((s) => s.id)]), [
    ['builder', 'shop', ['late', 'same-agent']],
    ['Claude Code', 'web', ['other-project']],
    ['Claude Code', 'shop', ['overnight']],
    ['Nightly', 'scheduled', []],
  ])
  assert.equal(rows[0].bars.length, 3)
  // A chat that ran past midnight starts at midnight on the timetable.
  assert.equal(rows[2].bars[0].from, tuesday.getTime())
  assert.deepEqual(rows[3].planned, [new Date(2026, 10, 3, 22).getTime()])
})
