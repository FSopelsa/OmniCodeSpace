import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { allSessions, claudeLimits, codexLimits, lastScan, projectOf, readClaude, readCodex, sessionsIn } from '../server/sessions.ts'

const home = mkdtempSync(join(tmpdir(), 'omni-home-'))
after(() => rmSync(home, { recursive: true, force: true }))

const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
const reply = (id: string, timestamp: string) => ({
  type: 'assistant', sessionId: 'claude-1', cwd: 'C:\\Work\\Shop', gitBranch: 'impl/auth', timestamp,
  message: { id, model: 'claude-test', usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 20 } },
})

test('reads both tools and survives odd lines', async () => {
  assert.deepEqual(await allSessions(join(home, 'nobody')), [])

  const claude = join(home, '.claude', 'projects', 'shop')
  mkdirSync(join(claude, 'subagents'), { recursive: true })
  writeFileSync(
    join(claude, 'a.jsonl'),
    jsonl([{ type: 'custom-title', customTitle: 'Auth work', sessionId: 'claude-1' }, { type: 'agent-setting', agentSetting: 'builder', sessionId: 'claude-1' }, reply('m1', '2026-11-01T10:00:00Z'), reply('m1', '2026-11-01T10:00:01Z'), reply('m2', '2026-11-01T10:05:00Z')]) + 'not json\n',
  )
  writeFileSync(join(claude, 'subagents', 'agent-a1.jsonl'), jsonl([reply('s', '2026-11-01T11:00:00Z')]))
  writeFileSync(join(claude, 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Find the auth code' }))

  const codex = join(home, '.codex', 'sessions', '2026', '11', '02')
  mkdirSync(codex, { recursive: true })
  writeFileSync(join(home, '.codex', 'session_index.jsonl'), jsonl([{ id: 'codex-1', thread_name: 'Review', updated_at: 'x' }]))
  writeFileSync(
    join(codex, 'rollout.jsonl'),
    jsonl([
      { type: 'session_meta', timestamp: '2026-11-02T09:00:00Z', payload: { id: 'codex-1', cwd: 'C:/Work/Other', git: { branch: 'main' } } },
      { type: 'turn_context', timestamp: '2026-11-02T09:00:01Z', payload: { model: 'gpt-test', cwd: 'C:/Work/Other' } },
      { type: 'event_msg', timestamp: '2026-11-02T09:01:00Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 50, cached_input_tokens: 30, output_tokens: 7 } } } },
      { type: 'turn_context', timestamp: '2026-11-02T09:30:00Z', payload: { model: 'gpt-test', effort: 'high', cwd: 'C:/Work/Other' } },
    ]),
  )
  writeFileSync(
    join(codex, 'spawned.jsonl'),
    jsonl([{ type: 'session_meta', timestamp: '2026-11-02T08:00:00Z', payload: { id: 'codex-2', cwd: 'C:/Work/Other', source: { subagent: { thread_spawn: { parent_thread_id: 'codex-1', agent_role: 'reviewer' } } } } }]),
  )

  const sessions = await allSessions(home)
  assert.deepEqual(sessions.map((s) => s.id), ['codex-1', 'codex-2', 'agent-a1', 'claude-1'])

  const [codexSession, spawned, subagent, claudeSession] = sessions
  assert.deepEqual([claudeSession.agent, claudeSession.parent], ['builder', ''])
  assert.deepEqual([subagent.agent, subagent.parent, subagent.title, subagent.cwd], ['Explore', 'claude-1', 'Find the auth code', 'C:\\Work\\Shop'])
  assert.deepEqual([spawned.agent, spawned.parent], ['reviewer', 'codex-1'])
  assert.deepEqual([codexSession.agent, codexSession.parent], ['', ''])
  assert.equal(claudeSession.title, 'Auth work')
  assert.equal(claudeSession.branch, 'impl/auth')
  assert.equal(claudeSession.last, '2026-11-01T10:05:00Z')
  assert.deepEqual(claudeSession.spans, [['2026-11-01T10:00:00Z', '2026-11-01T10:05:00Z']])
  // m1 appears twice in the log and only counts once.
  assert.deepEqual(claudeSession.tokens, { input: 30, cached: 200, output: 40 })

  assert.equal(codexSession.title, 'Review')
  assert.equal(codexSession.model, 'gpt-test')
  assert.equal(codexSession.effort, 'high')
  // A pause of over 15 minutes starts a new stretch of work.
  assert.deepEqual(codexSession.spans, [['2026-11-02T09:00:00Z', '2026-11-02T09:01:00Z'], ['2026-11-02T09:30:00Z', '2026-11-02T09:30:00Z']])
  assert.deepEqual(codexSession.tokens, { input: 20, cached: 30, output: 7 })
})

test('matches folders whatever the slash direction or case, and not by name prefix', async () => {
  const sessions = await allSessions(home)
  assert.deepEqual(sessionsIn(sessions, ['c:/work/shop']).map((s) => s.id), ['agent-a1', 'claude-1'])
  assert.deepEqual(sessionsIn(sessions, ['C:\\Work\\Shop\\']).map((s) => s.id), ['agent-a1', 'claude-1'])
  assert.deepEqual(sessionsIn(sessions, ['C:/Work/Sho']), [])
  // A worktree git no longer lists still counts for its repo.
  const gone = { ...sessions[0], cwd: 'C:\\Work\\Shop.worktrees\\gone' }
  assert.deepEqual(sessionsIn([gone], ['c:/work/shop']), [gone])
})

test('names the project a session belonged to, including worktrees this app starts beside it', () => {
  const repos = ['C:\\Work\\Shop', 'C:\\Work\\Shop-web']
  assert.equal(projectOf('c:/work/shop/src', repos), 'Shop')
  assert.equal(projectOf('C:\\Work\\Shop.worktrees\\add-login-3f2a', repos), 'Shop')
  assert.equal(projectOf('C:\\Work\\Shop-web', repos), 'Shop-web')
  assert.equal(projectOf('C:\\Elsewhere\\Tool', repos), 'Tool')
})

test('reads plan usage from the newest Codex log and the Claude widget file', async () => {
  const plan = mkdtempSync(join(tmpdir(), 'omni-plan-'))
  after(() => rmSync(plan, { recursive: true, force: true }))
  delete process.env.CLAUDE_CONFIG_DIR
  const usage = (timestamp: string, limits: unknown) => ({ type: 'event_msg', timestamp, payload: { type: 'token_count', rate_limits: limits } })
  const dir = join(plan, '.codex', 'sessions')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'old.jsonl'), jsonl([
    { type: 'session_meta', timestamp: '2026-11-01T09:00:00Z', payload: { id: 'old', cwd: 'C:/Work' } },
    usage('2026-11-01T09:00:00Z', { limit_id: 'codex', primary: { used_percent: 90, window_minutes: 300, resets_at: 100 } }),
  ]))
  writeFileSync(join(dir, 'new.jsonl'), jsonl([
    { type: 'session_meta', timestamp: '2026-11-02T09:00:00Z', payload: { id: 'new', cwd: 'C:/Work' } },
    usage('2026-11-02T09:00:00Z', { primary: { used_percent: 20, window_minutes: 300, resets_at: 200 }, secondary: { used_percent: 140 } }),
    // Another bucket and a reading with no usable windows leave the last good reading in place.
    usage('2026-11-02T09:05:00Z', { limit_id: 'other', primary: { used_percent: 5 } }),
    usage('2026-11-02T09:06:00Z', { primary: null }),
  ]))
  assert.deepEqual(codexLimits(await allSessions(plan)), { at: '2026-11-02T09:00:00Z', windows: [{ used: 20, minutes: 300, resets: 200 }] })

  assert.equal(await claudeLimits(plan), null)
  mkdirSync(join(plan, '.claude', 'usage-widget'), { recursive: true })
  const file = join(plan, '.claude', 'usage-widget', 'usage.json')
  writeFileSync(file, JSON.stringify({ received_at: '2026-11-05T14:16:49.2960863+00:00', rate_limits: { five_hour: { used_percentage: 29, resets_at: 300 }, seven_day: { used_percentage: 50, resets_at: null } } }))
  assert.deepEqual(await claudeLimits(plan), { at: '2026-11-05T14:16:49.296Z', windows: [{ used: 29, minutes: 300, resets: 300 }, { used: 50, minutes: 10080, resets: 0 }] })
  writeFileSync(file, '{"received_at":')
  assert.equal(await claudeLimits(plan), null)
})

test('a session knows whose turn it is', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-turn-'))
  after(() => rmSync(dir, { recursive: true, force: true }))
  const log = (name: string, rows: unknown[]) => (writeFileSync(join(dir, name), jsonl(rows)), join(dir, name))
  const said = (stop_reason: string) => ({ type: 'assistant', sessionId: 'c', cwd: 'C:/Work', timestamp: '2026-11-05T10:00:00Z', message: { id: stop_reason, stop_reason, usage: {} } })
  const user = (content: unknown) => ({ type: 'user', sessionId: 'c', cwd: 'C:/Work', timestamp: '2026-11-05T10:00:01Z', message: { role: 'user', content } })
  const ended = log('ended.jsonl', [user('Hi'), said('tool_use'), user([{ type: 'tool_result', content: 'ok' }]), said('end_turn'), { type: 'last-prompt', sessionId: 'c' }])
  const working = log('working.jsonl', [user('Hi'), said('tool_use'), user([{ type: 'tool_result', content: 'ok' }])])
  const interrupted = log('interrupted.jsonl', [user('Hi'), said('tool_use'), user([{ type: 'text', text: '[Request interrupted by user]' }])])
  assert.deepEqual((await Promise.all([ended, working, interrupted].map(readClaude))).map((s) => s.turnOver), [true, false, true])

  const event = (type: string) => ({ type: 'event_msg', timestamp: '2026-11-05T10:00:00Z', payload: { type } })
  const meta = { type: 'session_meta', timestamp: '2026-11-05T10:00:00Z', payload: { id: 'x', cwd: 'C:/Work' } }
  const complete = log('complete.jsonl', [meta, event('task_started'), event('task_complete')])
  const started = log('started.jsonl', [meta, event('task_complete'), event('task_started')])
  assert.deepEqual((await Promise.all([complete, started].map((f) => readCodex(f)))).map((s) => s.turnOver), [true, false])
})

test('logs that give no session are counted', async () => {
  const other = mkdtempSync(join(tmpdir(), 'omni-scan-'))
  after(() => rmSync(other, { recursive: true, force: true }))
  const dir = join(other, '.claude', 'projects', 'shop')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'good.jsonl'), jsonl([reply('m1', '2026-11-01T10:00:00Z')]))
  writeFileSync(join(dir, 'new-format.jsonl'), jsonl([{ type: 'something-new' }]))
  await allSessions(other)
  assert.deepEqual(lastScan, { files: 2, unread: 1 })
})

test('Esc in Codex hands the turn back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-abort-'))
  after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'aborted.jsonl')
  const event = (type: string) => ({ type: 'event_msg', timestamp: '2026-11-05T10:00:00Z', payload: { type } })
  writeFileSync(file, jsonl([{ type: 'session_meta', timestamp: '2026-11-05T10:00:00Z', payload: { id: 'x', cwd: 'C:/Work' } }, event('task_started'), event('turn_aborted')]))
  assert.equal((await readCodex(file)).turnOver, true)
})
