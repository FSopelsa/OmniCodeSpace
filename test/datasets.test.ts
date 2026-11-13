import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Commit } from '../server/git.ts'
import type { Session } from '../server/sessions.ts'
import type { BandTask } from '../server/band.ts'
import { activityByHour, commitsByWeek, taskRows, testState, tokensByDay } from '../src/datasets.ts'

// Tuesday 3 November 2026, local time.
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).toISOString()
const session = (over: Partial<Session>): Session => ({
  tool: 'Claude Code', id: 'a', log: 'a.jsonl', title: '', model: '', effort: '', cwd: '', branch: '', last: at(3, 12), spans: [], tokens: { input: 0, cached: 0, output: 0 }, agent: '', parent: '', ...over,
})
const commit = (date: string, agent: string): Commit => ({ sha: date, parents: [], author: 'Felix', date, subject: '', refs: [], agent, why: '' })

test('sums tokens per day and tool, from the start of the range', () => {
  const rows = tokensByDay([
    session({ last: at(3, 9), tokens: { input: 100, cached: 1000, output: 10 } }),
    session({ last: at(3, 18), tokens: { input: 50, cached: 500, output: 5 }, parent: 'a' }),
    session({ last: at(3, 10), tool: 'Codex', tokens: { input: 7, cached: 0, output: 3 } }),
    session({ last: at(1, 10), tokens: { input: 999, cached: 0, output: 0 } }),
  ], new Date(2026, 10, 2).getTime())
  assert.deepEqual(rows, [
    { day: new Date(2026, 10, 3).getTime(), tool: 'Claude Code', uncached: 165, cached: 1500 },
    { day: new Date(2026, 10, 3).getTime(), tool: 'Codex', uncached: 10, cached: 0 },
  ])
})

test('splits stretches of work at each hour and leaves out subagents', () => {
  const rows = activityByHour([
    session({ spans: [[at(3, 9, 40), at(3, 11, 10)]] }),
    session({ spans: [[at(3, 9, 0), at(3, 9, 30)]], parent: 'a' }),
  ], 0)
  assert.deepEqual(rows, [
    { weekday: 'Tue', hour: 9, minutes: 20 },
    { weekday: 'Tue', hour: 10, minutes: 60 },
    { weekday: 'Tue', hour: 11, minutes: 10 },
  ])
  // A stretch that started before the range only counts from its start.
  assert.deepEqual(activityByHour([session({ spans: [[at(3, 9, 0), at(3, 10, 30)]] })], new Date(2026, 10, 3, 10).getTime()), [{ weekday: 'Tue', hour: 10, minutes: 30 }])
})

test('counts commits per Monday-first week, folding all but the three busiest names into Other', () => {
  const commits = [
    commit(at(3, 9), 'Claude Code (Opus 5.5), fixing tests'),
    commit(at(4, 9), 'Claude Code'),
    commit(at(9, 9), 'Claude Code'),
    commit(at(2, 9), 'Codex'),
    commit(at(5, 9), 'Codex'),
    commit(at(5, 10), ''),
    commit(at(6, 10), 'Local builder'),
  ]
  const { names, rows } = commitsByWeek(commits, 0)
  assert.deepEqual(names, ['Claude Code', 'Codex', 'Local builder', 'Other'])
  const week = new Date(2026, 10, 2).getTime()
  assert.deepEqual(rows, [
    { week, who: 'Claude Code', commits: 2 },
    { week, who: 'Codex', commits: 2 },
    { week, who: 'Local builder', commits: 1 },
    { week, who: 'Other', commits: 1 },
    { week: new Date(2026, 10, 9).getTime(), who: 'Claude Code', commits: 1 },
  ])
  // The range filters rows, never the names, so colours stay put.
  assert.deepEqual(commitsByWeek(commits, new Date(2026, 10, 9).getTime()).names, names)
})

const task = (over: Partial<BandTask>): BandTask => ({
  key: 'k', started: '2026-11-05 01:29', name: 'Task', cost: 1, turns: 1, minutes: 1, tokens: 1, output: 1, reuse: null, tests: 'not run', level: 'full', model: '', ...over,
})

test('reads a test result as passed, failed, stale or not run', () => {
  assert.equal(testState('74 passed'), 'passed')
  assert.equal(testState('3 failed'), 'failed')
  assert.equal(testState('74 passed, 2 failed'), 'failed')
  assert.equal(testState('74 passed, 0 failed'), 'passed')
  assert.equal(testState('stale'), 'stale')
  assert.equal(testState('not run'), 'not run')
  assert.equal(testState(''), 'not run')
})

test('places tasks at their local start time, from the start of the range', () => {
  const rows = taskRows([
    task({ key: 'old', started: '2026-11-01 10:00' }),
    task({ key: 'new', started: '2026-11-05 01:29', name: 'Fix it', cost: null, reuse: 25, tests: '74 passed' }),
  ], new Date(2026, 10, 2).getTime())
  assert.deepEqual(rows, [
    { at: new Date(2026, 10, 5, 1, 29).getTime(), name: 'Fix it', cost: null, turns: 1, minutes: 1, tokens: 1, reuse: 25, tests: '74 passed', state: 'passed' },
  ])
})
