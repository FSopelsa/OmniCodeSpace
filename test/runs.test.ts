import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { api, token } from '../server/api.ts'
import { git, rev } from '../server/git.ts'
import { checkQuiet, command, describe, listRuns, loadRuns, removeRun, reviewRun, startRun, stopRun, watchRun, type Run } from '../server/runs.ts'

const GATE = join(import.meta.dirname, '..', 'server', 'gate.ts')
const root = mkdtempSync(join(tmpdir(), 'omni-runs-'))
const repo = join(root, 'shop')
const agent = join(root, 'fake-agent.mjs')
let server: Server
let base = ''

// Stands in for Claude Code: reads the task, commits a file, then asks to push through the real gate.
writeFileSync(
  agent,
  `import { execFileSync, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
let task = ''
for await (const chunk of process.stdin) task += chunk
const say = (o) => console.log(JSON.stringify(o))
say({ type: 'system', subtype: 'init', model: 'fake-model' })
if (process.argv[2] === 'hang') setInterval(() => {}, 1000)
else if (process.argv[2] === 'quick') {
  say({ type: 'assistant', message: { content: [{ type: 'text', text: 'cwd ' + process.cwd() }] } })
  say({ type: 'result', num_turns: 1, permission_denials: [] })
} else {
  say({ type: 'assistant', message: { content: [{ type: 'text', text: 'Working on: ' + task }] } })
  writeFileSync('hello.txt', 'hi\\n')
  execFileSync('git', ['add', 'hello.txt'])
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'Add hello'])
  const gate = spawnSync(process.execPath, [${JSON.stringify(GATE)}], { input: JSON.stringify({ tool_input: { command: 'git push origin HEAD' } }), encoding: 'utf8' })
  say({ type: 'assistant', message: { content: [{ type: 'text', text: 'Gate said: ' + gate.stdout }] } })
  say({ type: 'result', num_turns: 2, total_cost_usd: 0.01, permission_denials: [] })
}
`,
)
const fake = (mode = ''): [string, string[]] => [process.execPath, [agent, ...(mode ? [mode] : [])]]

before(async () => {
  mkdirSync(repo)
  await git(repo, 'init', '-b', 'main')
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  await git(repo, 'add', '.')
  await git(repo, '-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'First')
  base = await git(repo, 'rev-parse', 'HEAD')
  process.env.OMNI_ROOTS = root
  // Vite mounts the API at /api, and strips that prefix before calling it.
  server = createServer((req, res) => {
    req.url = req.url!.replace(/^\/api/, '')
    api(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
})
after(() => {
  server.close()
  rmSync(root, { recursive: true, force: true })
})

const address = () => `http://127.0.0.1:${(server.address() as { port: number }).port}/api`
const post = (path: string, body: unknown, withToken = true) =>
  fetch(`${address()}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(withToken ? { 'x-omni-token': token } : {}) }, body: JSON.stringify(body) })

function until(id: string, done: (run: Run) => boolean) {
  return new Promise<Run>((resolve) => {
    const w = watchRun(id, () => done(w.run) && (w.stop(), resolve(w.run)))
    if (done(w.run)) (w.stop(), resolve(w.run))
  })
}

test('turns Claude Code and Codex output into readable lines', () => {
  assert.deepEqual(describe('Claude Code', JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }, { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }, { type: 'thinking', thinking: 'x' }] } })), [
    { kind: 'say', text: 'Hi' },
    { kind: 'tool', text: 'Bash: npm test' },
  ])
  assert.deepEqual(describe('Claude Code', JSON.stringify({ type: 'result', num_turns: 3, total_cost_usd: 0.123, permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'rm -rf x' } }] })), [
    { kind: 'note', text: 'Done after 3 turns, about $0.12 at API prices' },
    { kind: 'error', text: 'Refused by your Claude Code permission rules: rm -rf x' },
  ])
  assert.deepEqual(describe('Codex', JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'npm test', exit_code: 1 } })), [{ kind: 'error', text: 'npm test, exit code 1' }])
  assert.deepEqual(describe('Codex', JSON.stringify({ type: 'item.completed', item: { type: 'file_change', changes: [{ path: 'a.ts' }, { path: 'b.ts' }] } })), [{ kind: 'tool', text: 'Changed a.ts, b.ts' }])
  assert.deepEqual(describe('Codex', JSON.stringify({ type: 'turn.started' })), [])
  assert.deepEqual(describe('Claude Code', ''), [])
})

test('a read-only run says so when it starts', () => {
  const init = (tools?: string[]) => describe('Claude Code', JSON.stringify({ type: 'system', subtype: 'init', model: 'm', tools }))[0].text
  assert.equal(init(['Read', 'Grep', 'Glob']), 'Started m, can only read')
  assert.equal(init(['Read', 'Edit', 'Bash']), 'Started m, edits allowed in this worktree')
  assert.equal(init(), 'Started m, edits allowed in this worktree')
})

test('Codex runs get no network, and Claude runs get the push gate', () => {
  assert.ok(command('Codex', '')[1].includes('sandbox_workspace_write.network_access=false'))
  const claude = command('Claude Code', 'haiku')[1]
  assert.match(claude[claude.indexOf('--settings') + 1], /PreToolUse.*Bash\|PowerShell.*gate\.ts/)
  assert.deepEqual(claude.slice(-2), ['--model', 'haiku'])
  assert.ok(claude.includes('Bash(git commit:*)') && !claude.some((a) => /push/.test(a) && !a.includes('gate')))
})

test('read-only commands can only read', () => {
  const [, claude] = command('Claude Code', 'haiku', true)
  for (const flag of ['--restricted', '--strict-mcp-config', '-p', 'stream-json']) assert.ok(claude.includes(flag), flag)
  assert.equal(claude[claude.indexOf('--tools') + 1], 'Read,Grep,Glob')
  for (const flag of ['--permission-mode', '--settings', '--allowedTools']) assert.ok(!claude.includes(flag), flag)
  const [, codex] = command('Codex', '', true)
  assert.equal(codex[codex.indexOf('-s') + 1], 'read-only')
  assert.ok(!codex.includes('workspace-write'))
})

test('a run can use an existing branch, another folder, and a callback that ends it', async () => {
  await git(repo, 'branch', 'omni/orders/t1')
  let ended: Run | undefined
  const run = await startRun(repo, { tool: 'Claude Code', task: 'x', branch: 'omni/orders/t1', from: 'omni/orders/t1', cwd: root, order: { branch: 'omni/orders/t1', ask: '' },
    onEnd: async (r) => { ended = { ...r }; assert.equal(r.status, 'finished') } }, address(), fake('quick'))
  assert.equal(run.branch, 'omni/orders/t1')
  assert.ok(run.worktree.endsWith('omni-orders-t1'))
  const done = await until(run.id, (r) => r.status === 'finished')
  assert.ok(ended, 'onEnd ran before the status changed')
  assert.ok(done.lines.some((l) => l.text.includes(root)), 'the agent ran in cwd')
})

test('a run gets its own branch and worktree, waits for your click to push, and can be reviewed', async () => {
  const run = await startRun(repo, { tool: 'Claude Code', task: 'Add a hello file!' }, address(), fake())
  assert.match(run.branch, /^omni\/add-a-hello-file-[0-9a-f]{6}$/)
  assert.equal(run.worktree, `${repo}.worktrees/${run.branch.slice(5)}`)
  assert.ok(existsSync(join(run.worktree, 'a.txt')))

  const waiting = await until(run.id, (r) => r.status === 'waiting')
  assert.equal(waiting.ask, 'git push origin HEAD')
  // The agent can't answer for you: answering needs the page's token, and asking needs the run's own key.
  assert.equal((await post('/runs/answer', { id: run.id, allow: true }, false)).status, 403)
  assert.equal((await post('/runs/ask', { run: run.id, key: 'guess', command: 'git push' }, false)).status, 403)
  assert.equal((await post('/runs/answer', { id: run.id, allow: true })).status, 200)

  const done = await until(run.id, (r) => r.status === 'finished')
  const text = done.lines.map((l) => l.text).join('\n')
  assert.match(text, /Working on: Add a hello file!/)
  assert.match(text, /You allowed the push/)
  assert.match(text, /Gate said: .*"permissionDecision":"allow"/)
  assert.deepEqual(listRuns().find((r) => r.id === run.id)?.lines, [])

  const review = await reviewRun(run.id)
  assert.match(review.commits[0], /^[0-9a-f]+ Add hello$/)
  assert.match(review.diff, /hello\.txt/)
  assert.equal(await git(repo, 'rev-parse', 'HEAD'), base, 'the main checkout stays where it was')
})

test('a refused push is denied, and stop ends the whole run', async () => {
  const run = await startRun(repo, { tool: 'Claude Code', task: 'Again' }, address(), fake())
  await until(run.id, (r) => r.status === 'waiting')
  await post('/runs/answer', { id: run.id, allow: false })
  const done = await until(run.id, (r) => r.status === 'finished')
  assert.match(done.lines.map((l) => l.text).join('\n'), /"permissionDecision":"deny"/)

  const hung = await startRun(repo, { tool: 'Claude Code', task: 'Wait forever' }, address(), fake('hang'))
  await until(hung.id, (r) => r.lines.length > 0)
  stopRun(hung.id)
  assert.equal((await until(hung.id, (r) => r.status !== 'running')).status, 'stopped')
})

test('the gate has no opinion on other commands, and refuses when the app is unreachable', () => {
  const gate = (command: string, env = {}) => spawnSync(process.execPath, [GATE], { input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8', env: { ...process.env, ...env } })
  assert.equal(gate('npm test').stdout, '')
  assert.equal(gate('git status').stdout, '')
  assert.match(gate('cd x && git -C . push --force', { OMNI_API: 'http://127.0.0.1:9/api' }).stdout, /"permissionDecision":"deny"/)
  assert.equal(spawnSync(process.execPath, [GATE], { input: 'not json', encoding: 'utf8' }).status, 0)
})

test('starting a run checks its input, and needs the token', async () => {
  const start = (body: object, withToken = true) => post('/runs', { repo, tool: 'Claude Code', task: 'x', ...body }, withToken)
  assert.equal((await start({}, false)).status, 403)
  assert.equal((await start({ tool: 'Gemini' })).status, 400)
  assert.equal((await start({ model: '--dangerously-skip-permissions' })).status, 400)
  assert.equal((await start({ task: ' ' })).status, 400)
  assert.equal((await start({ repo: root })).status, 404)
  const events = await fetch(`${address()}/runs/events?id=nope`)
  assert.equal(events.status, 404)
})

test('run records survive a restart, and a damaged one is skipped', async () => {
  const store = join(repo, '.git', 'omni', 'runs')
  const run = await startRun(repo, { tool: 'Claude Code', task: 'save me' }, address(), fake('quick'))
  const done = await until(run.id, (r) => r.status === 'finished')
  assert.equal(JSON.parse(readFileSync(join(store, `${done.id}.json`), 'utf8')).status, 'finished')
  writeFileSync(join(store, 'aaaaaa.json'), JSON.stringify({ ...done, id: 'aaaaaa', status: 'running' }))
  writeFileSync(join(store, 'bbbbbb.json'), '{"id": "bbbb')
  await loadRuns([repo])
  assert.equal(listRuns().find((r) => r.id === 'aaaaaa')?.status, 'stopped')
  assert.match(watchRun('aaaaaa', () => {}).run.lines.at(-1)!.text, /^The server restarted during this run/)
  assert.ok(!listRuns().some((r) => r.id === 'bbbbbb'))
})

test('a quiet run gets one warning', async () => {
  const run = await startRun(repo, { tool: 'Claude Code', task: 'hang' }, address(), fake('hang'))
  await until(run.id, (r) => r.lines.length > 0)
  checkQuiet(Date.now() + 11 * 60_000)
  checkQuiet(Date.now() + 12 * 60_000)
  assert.equal(watchRun(run.id, () => {}).run.lines.filter((l) => l.text.startsWith('No output for 10 minutes')).length, 1)
  stopRun(run.id)
  await until(run.id, (r) => r.status === 'stopped')
})

const commit = (dir: string, file: string, text: string) =>
  (writeFileSync(join(dir, file), text), git(dir, 'add', file).then(() => git(dir, '-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', `Change ${file}`)))

test('review says whether the branch merges cleanly', async () => {
  const run = await startRun(repo, { tool: 'Claude Code', task: 'conflict' }, address(), fake('quick'))
  await until(run.id, (r) => r.status === 'finished')
  await commit(run.worktree, 'a.txt', 'from the run\n')
  assert.deepEqual((await reviewRun(run.id)).merge, { into: 'main', conflicts: [] })
  await commit(repo, 'a.txt', 'from main\n')
  assert.deepEqual((await reviewRun(run.id)).merge, { into: 'main', conflicts: ['a.txt'] })
  await git(repo, 'checkout', '-q', '--detach')
  assert.equal((await reviewRun(run.id)).merge, null)
  await git(repo, 'checkout', '-q', 'main')
})

test("a finished run's folder can be removed, never with uncommitted work, and its branch stays", async () => {
  const hung = await startRun(repo, { tool: 'Claude Code', task: 'busy' }, address(), fake('hang'))
  await assert.rejects(removeRun(hung.id), /Stop it first/)
  stopRun(hung.id)
  await until(hung.id, (r) => r.status === 'stopped')

  const run = await startRun(repo, { tool: 'Claude Code', task: 'tidy' }, address(), fake('quick'))
  await until(run.id, (r) => r.status === 'finished')
  writeFileSync(join(run.worktree, 'left.txt'), 'mine\n')
  await assert.rejects(removeRun(run.id), /uncommitted changes/)
  assert.ok(existsSync(join(run.worktree, 'left.txt')))
  rmSync(join(run.worktree, 'left.txt'))
  await removeRun(run.id)
  assert.ok(!existsSync(run.worktree))
  assert.ok(await rev(repo, `refs/heads/${run.branch}`))
  assert.ok(!listRuns().some((r) => r.id === run.id))
  assert.ok(!existsSync(join(repo, '.git', 'omni', 'runs', `${run.id}.json`)))
})

test('a Claude Code run says which login it bills', async () => {
  const first = async () => {
    const run = await startRun(repo, { tool: 'Claude Code', task: 'who pays' }, address(), fake('quick'))
    return (await until(run.id, (r) => r.status === 'finished')).lines[0].text
  }
  const key = process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  assert.equal(await first(), 'Uses your Claude Code login.')
  process.env.ANTHROPIC_API_KEY = 'test-key'
  assert.equal(await first(), 'Bills your API key, because ANTHROPIC_API_KEY is set.')
  if (key === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = key
})

test('a record with odd fields is skipped, and a run another live server owns stays hidden', async (t) => {
  const store = join(repo, '.git', 'omni', 'runs')
  const [sample] = listRuns()
  writeFileSync(join(store, 'dddddd.json'), JSON.stringify({ ...sample, id: 'dddddd', started: 1, lines: [] }))
  const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
  t.after(() => other.kill())
  writeFileSync(join(store, 'eeeeee.json'), JSON.stringify({ ...sample, id: 'eeeeee', status: 'running', lines: [], server: other.pid }))
  await loadRuns([repo])
  assert.ok(!listRuns().some((r) => r.id === 'dddddd' || r.id === 'eeeeee'))
  other.kill()
  await new Promise((resolve) => other.on('exit', resolve))
  await loadRuns([repo])
  assert.equal(listRuns().find((r) => r.id === 'eeeeee')?.status, 'stopped')
})
