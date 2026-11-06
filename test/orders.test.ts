import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { git, rev } from '../server/git.ts'
import { ORDER_BRANCH, checkOrders, listOrders, runOrder, sendOrder } from '../server/orders.ts'
import { watchRun, type Run } from '../server/runs.ts'

Object.assign(process.env, { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' })
const root = mkdtempSync(join(tmpdir(), 'omni-orders-'))
const remote = join(root, 'remote.git')
const shop = join(root, 'projects', 'shop')
const docs = join(root, 'projects', 'docs')
const lib = join(root, 'projects', 'lib')
// Stands in for the cloud session that sends orders.
const cloud = join(root, 'cloud')
const agent = join(root, 'fake-agent.mjs')
const repos = [shop, docs, lib]
const api = 'http://127.0.0.1:9/api'

// Stands in for Claude Code and Codex: leaves an uncommitted file unless it may only read, then says where it ran.
writeFileSync(
  agent,
  `import { writeFileSync } from 'node:fs'
let task = ''
for await (const chunk of process.stdin) task += chunk
const say = (o) => console.log(JSON.stringify(o))
if (process.argv[2] !== 'read') writeFileSync('done.txt', 'done\\n')
say({ type: 'assistant', message: { content: [{ type: 'text', text: 'Did it in ' + process.cwd() }] } })
say({ type: 'result', num_turns: 1, permission_denials: [] })
`,
)
const fake: [string, string[]] = [process.execPath, [agent]]

async function push(branch: string, text: string | null, ...trailers: string[]) {
  await git(cloud, 'switch', '-q', ...((await rev(cloud, `refs/heads/${branch}`)) ? [branch] : ['-c', branch, 'main']))
  if (text !== null) writeFileSync(join(cloud, 'order.md'), text)
  await git(cloud, 'add', '-A')
  await git(cloud, 'commit', '-q', '--allow-empty', '-m', 'Order', ...(trailers.length ? ['-m', trailers.join('\n')] : []))
  await git(cloud, 'push', '-q', 'origin', branch)
  await git(cloud, 'switch', '-q', 'main')
}

function until(id: string, done: (run: Run) => boolean) {
  return new Promise<Run>((resolve) => {
    const w = watchRun(id, () => done(w.run) && (w.stop(), resolve(w.run)))
    if (done(w.run)) (w.stop(), resolve(w.run))
  })
}

before(async () => {
  mkdirSync(join(root, 'projects'))
  await git(root, 'init', '-q', '--bare', '-b', 'main', remote)
  await git(root, 'init', '-q', '-b', 'main', cloud)
  writeFileSync(join(cloud, 'README.md'), '# Shop\n')
  await git(cloud, 'add', '.')
  await git(cloud, 'commit', '-q', '-m', 'First')
  await git(cloud, 'remote', 'add', 'origin', remote)
  await git(cloud, 'push', '-q', 'origin', 'main')
  for (const clone of [shop, lib]) await git(root, 'clone', '-q', remote, clone)
  await git(root, 'init', '-q', '-b', 'main', docs)
  writeFileSync(join(docs, 'README.md'), '# Docs\n')
  await git(docs, 'add', '.')
  await git(docs, 'commit', '-q', '-m', 'First')
  await git(docs, 'remote', 'add', 'origin', join(root, 'missing.git'))
  for (const on of [shop, docs]) await git(on, 'config', 'omni.orders', 'true')
})
after(() => rmSync(root, { recursive: true, force: true }))

test('the branch name rule', () => {
  for (const ok of ['omni/orders/fix-1', 'claude/order-2', 'claude/a/b.c']) assert.ok(ORDER_BRANCH.test(ok), ok)
  for (const bad of ['omni/orders/a+b', 'omni/orders/-x', 'omni/orders', 'main', 'claude/', 'omni/other/x']) assert.ok(!ORDER_BRANCH.test(bad), bad)
})

test('lists open orders and skips branches that are not orders', async () => {
  await push('omni/orders/fix-1', '# Fix the rounding\n\nUse two decimals.', 'Omni-To: Codex', 'Omni-Status: open')
  await push('claude/chat-abc', 'x')
  await push('claude/order-2', 'Add tests', 'Omni-To: Robot', 'Omni-Status: open')
  await push('omni/orders/a+b', 'x', 'Omni-Status: open')
  await push('omni/orders/no-file', null, 'Omni-Status: open')
  const { orders } = await checkOrders({ repos, api, now: true, cmd: fake })
  const by = Object.fromEntries(orders.map((o) => [o.branch, o]))
  assert.deepEqual(Object.keys(by).sort(), ['claude/order-2', 'omni/orders/fix-1', 'omni/orders/no-file'])
  assert.deepEqual([by['omni/orders/fix-1'].state, by['omni/orders/fix-1'].title, by['omni/orders/fix-1'].to, by['omni/orders/fix-1'].author], ['open', 'Fix the rounding', 'Codex', 'T'])
  assert.equal(by['claude/order-2'].to, 'Claude Code')
  assert.equal(by['omni/orders/no-file'].state, 'blocked')
  assert.match(by['omni/orders/no-file'].note!, /order\.md/)
})

test('only repos with orders on are fetched, and one failing repo does not hide the others', async () => {
  const { orders, errors } = await checkOrders({ repos, api, now: true, cmd: fake })
  assert.deepEqual(errors.map((e) => e.project), ['docs'])
  assert.ok(orders.every((o) => o.project === 'shop'), 'lib has orders off')
})

test('running an order commits a report, and Send back clears it', async () => {
  await push('omni/orders/run-1', 'Add done.txt', 'Omni-To: Claude Code', 'Omni-Status: open')
  await checkOrders({ repos, api, now: true, cmd: fake })
  const ctx = { repos, api, cmd: fake }
  await assert.rejects(runOrder(shop, 'omni/orders/no-file', { tool: 'Claude Code' }, ctx), /changed/)
  // Two clicks at once: only one starts.
  const [run, again] = await Promise.allSettled([runOrder(shop, 'omni/orders/run-1', { tool: 'Claude Code' }, ctx), runOrder(shop, 'omni/orders/run-1', { tool: 'Claude Code' }, ctx)])
  assert.equal(run.status, 'fulfilled')
  assert.match(String((again as PromiseRejectedResult).reason), /already running/)
  await until((run as PromiseFulfilledResult<Run>).value.id, (r) => r.status === 'finished')
  const order = (await listOrders(shop, repos)).find((o) => o.branch === 'omni/orders/run-1')!
  assert.equal(order.state, 'ready')
  assert.match(order.report!, /Did it in/, 'the report is there to read before Send back')
  assert.match(await git(shop, 'log', '-1', '--format=%B', 'omni/orders/run-1'), /Omni-Status: done/)
  assert.deepEqual((await git(shop, 'show', '--name-only', '--format=', 'omni/orders/run-1')).trim().split('\n').sort(), ['done.txt', 'report.md'])
  assert.match(await git(shop, 'show', 'omni/orders/run-1:report.md'), /Did it in/)
  const tip = await git(shop, 'rev-parse', 'omni/orders/run-1')
  assert.deepEqual(await sendOrder(shop, 'omni/orders/run-1', repos), { pushed: tip })
  assert.equal(await git(remote, 'rev-parse', 'omni/orders/run-1'), tip)
  assert.ok(!(await listOrders(shop, repos)).some((o) => o.branch === 'omni/orders/run-1'))
})

test('the sender can ask again after Send back, and the run starts from the new commit', async () => {
  await git(cloud, 'fetch', '-q', 'origin', 'omni/orders/run-1')
  await git(cloud, 'branch', '-f', 'omni/orders/run-1', 'FETCH_HEAD')
  await push('omni/orders/run-1', 'Now add more.txt', 'Omni-Status: open')
  const asked = await git(cloud, 'rev-parse', 'omni/orders/run-1')
  const { orders } = await checkOrders({ repos, api, now: true, cmd: fake })
  assert.equal(orders.find((o) => o.branch === 'omni/orders/run-1')?.state, 'open')
  const run = await runOrder(shop, 'omni/orders/run-1', { tool: 'Claude Code' }, { repos, api, cmd: fake })
  await until(run.id, (r) => r.status === 'finished')
  assert.equal(await git(shop, 'merge-base', '--is-ancestor', asked, 'omni/orders/run-1').then(() => true, () => false), true)
  assert.equal((await listOrders(shop, repos)).find((o) => o.branch === 'omni/orders/run-1')?.state, 'ready')
})

test('a rejected push is reported, and nothing is lost', async () => {
  await push('omni/orders/race', 'Do it', 'Omni-Status: open')
  await checkOrders({ repos, api, now: true, cmd: fake })
  await until((await runOrder(shop, 'omni/orders/race', { tool: 'Codex' }, { repos, api, cmd: fake })).id, (r) => r.status === 'finished')
  const mine = await git(shop, 'rev-parse', 'omni/orders/race')
  await push('omni/orders/race', 'Do it differently', 'Omni-Status: open')
  await assert.rejects(sendOrder(shop, 'omni/orders/race', repos), /moved on GitHub/)
  assert.equal(await git(shop, 'rev-parse', 'omni/orders/race'), mine)
  const { orders } = await checkOrders({ repos, api, now: true, cmd: fake })
  assert.equal(orders.find((o) => o.branch === 'omni/orders/race')!.state, 'diverged')
})

test('a very long order still runs', async () => {
  await push('omni/orders/long', 'x'.repeat(25_000), 'Omni-Status: open')
  await checkOrders({ repos, api, now: true, cmd: fake })
  const run = await runOrder(shop, 'omni/orders/long', { tool: 'Claude Code' }, { repos, api, cmd: fake })
  assert.ok(run.task.length <= 20_000)
  assert.match(run.task, /Cut short/)
  await until(run.id, (r) => r.status === 'finished')
})

test('a question to a project with orders on starts by itself, read-only, once at a time', async () => {
  await push('omni/orders/q-1', 'How does docs build?', 'Omni-Status: open', 'Omni-Ask: docs')
  await push('omni/orders/q-3', 'And its tests?', 'Omni-Status: open', 'Omni-Ask: docs')
  await push('omni/orders/q-2', 'And lib?', 'Omni-Status: open', 'Omni-Ask: lib')
  const read: [string, string[]] = [process.execPath, [agent, 'read']]
  const first = await checkOrders({ repos, api, now: true, cmd: read })
  const state = (b: string, list = first.orders) => list.find((o) => o.branch === b)!
  assert.equal([state('omni/orders/q-1'), state('omni/orders/q-3')].filter((o) => o.state === 'running').length, 1)
  assert.equal(state('omni/orders/q-2').state, 'blocked')
  const started = [state('omni/orders/q-1'), state('omni/orders/q-3')].find((o) => o.run)!
  const run = await until(started.run!, (r) => r.status === 'finished')
  assert.equal(run.order?.ask, 'docs')
  assert.ok((await git(shop, 'show', `${started.branch}:report.md`)).includes(docs), 'it ran in the docs checkout')
  const second = await checkOrders({ repos, api, now: true, cmd: read })
  assert.equal(state(started.branch, second.orders).state, 'ready')
  // The other question starts now that the first is done.
  const next = second.orders.find((o) => o.ask === 'docs' && o.branch !== started.branch)!
  assert.equal(next.state, 'running')
  await until(next.run!, (r) => r.status === 'finished')
})

test('two checks at once still start only one question', async () => {
  await push('omni/orders/q-6', 'One?', 'Omni-Status: open', 'Omni-Ask: docs')
  await push('omni/orders/q-7', 'Two?', 'Omni-Status: open', 'Omni-Ask: docs')
  const read: [string, string[]] = [process.execPath, [agent, 'read']]
  const both = await Promise.all([checkOrders({ repos, api, now: true, cmd: read }), checkOrders({ repos, api, now: true, cmd: read })])
  const mine = both.flatMap((c) => c.orders).filter((o) => ['omni/orders/q-6', 'omni/orders/q-7'].includes(o.branch))
  const runs = mine.filter((o) => o.run)
  assert.equal(new Set(runs.map((o) => o.run)).size, 1)
  // The losing check must not mark the question as failed, which would block it until a restart.
  assert.deepEqual(mine.filter((o) => o.state === 'blocked').map((o) => o.note), [])
  await until(runs[0].run!, (r) => r.status === 'finished')
  // Let the other one run too, so later tests start with no question open.
  const rest = (await checkOrders({ repos, api, now: true, cmd: read })).orders.find((o) => ['omni/orders/q-6', 'omni/orders/q-7'].includes(o.branch) && o.state === 'running')
  if (rest) await until(rest.run!, (r) => r.status === 'finished')
})

test('a question whose report commit fails is not started again', async () => {
  await push('omni/orders/q-4', 'Anything?', 'Omni-Status: open', 'Omni-Ask: docs')
  // Hooks don't run on order branches, so a date git refuses makes the commit fail instead.
  process.env.GIT_AUTHOR_DATE = 'not a date'
  try {
    const read: [string, string[]] = [process.execPath, [agent, 'read']]
    const first = await checkOrders({ repos, api, now: true, cmd: read })
    const run = await until(first.orders.find((o) => o.branch === 'omni/orders/q-4')!.run!, (r) => r.status === 'finished')
    assert.ok(run.lines.some((l) => l.kind === 'error'), 'the failed commit is a line in the run')
    const again = (await checkOrders({ repos, api, now: true, cmd: read })).orders.find((o) => o.branch === 'omni/orders/q-4')!
    assert.equal(again.state, 'blocked')
    assert.match(again.note!, /report/)
  } finally {
    delete process.env.GIT_AUTHOR_DATE
  }
})

const ctx = { repos, api, cmd: fake }

test('Run refuses an order that changed after you read it', async () => {
  await push('omni/orders/moved', 'Add a README line', 'Omni-Status: open')
  const seen = (await checkOrders({ ...ctx, now: true })).orders.find((o) => o.branch === 'omni/orders/moved')!
  await push('omni/orders/moved', 'Something else entirely', 'Omni-Status: open')
  await checkOrders({ ...ctx, now: true })
  await assert.rejects(runOrder(shop, 'omni/orders/moved', { tool: 'Claude Code', sha: seen.sha }, ctx), /changed/)
})

test('a ready order whose sender committed on top shows as diverged, not gone', async () => {
  await push('omni/orders/plain', 'Do a thing', 'Omni-Status: open')
  const order = (await checkOrders({ ...ctx, now: true })).orders.find((o) => o.branch === 'omni/orders/plain')!
  await until((await runOrder(shop, order.branch, { tool: 'Claude Code', sha: order.sha }, ctx)).id, (r) => r.status === 'finished')
  await push('omni/orders/plain', null)
  const after = (await checkOrders({ ...ctx, now: true })).orders.find((o) => o.branch === 'omni/orders/plain')
  assert.equal(after?.state, 'diverged')
})

test('a question whose tool cannot start gets a failed report, and is not started again', async () => {
  await push('omni/orders/q-5', 'Anything?', 'Omni-Status: open', 'Omni-Ask: docs')
  const missing: [string, string[]] = [join(root, 'no-such-agent.exe'), []]
  const first = await checkOrders({ repos, api, now: true, cmd: missing })
  await until(first.orders.find((o) => o.branch === 'omni/orders/q-5')!.run!, (r) => r.status === 'failed')
  const again = (await checkOrders({ repos, api, now: true, cmd: missing })).orders.find((o) => o.branch === 'omni/orders/q-5')!
  assert.equal(again.state, 'ready')
  assert.match(await git(shop, 'log', '-1', '--format=%B', 'omni/orders/q-5'), /Omni-Status: failed/)
})

test("the sender's git hooks never run on this PC", async () => {
  const marker = join(root, 'hook-ran').replaceAll('\\', '/')
  await git(shop, 'config', 'core.hooksPath', '.githooks')
  try {
    await git(cloud, 'switch', '-q', '-c', 'omni/orders/hooked', 'main')
    mkdirSync(join(cloud, '.githooks'))
    for (const hook of ['pre-commit', 'prepare-commit-msg', 'post-commit', 'post-checkout', 'post-merge', 'reference-transaction']) {
      writeFileSync(join(cloud, '.githooks', hook), `#!/bin/sh\necho ${hook} >> "${marker}"\n`, { mode: 0o755 })
    }
    writeFileSync(join(cloud, 'order.md'), 'Do it')
    await git(cloud, 'add', '-A')
    await git(cloud, 'commit', '-q', '-m', 'Order', '-m', 'Omni-Status: open')
    await git(cloud, 'push', '-q', 'origin', 'omni/orders/hooked')
    await git(cloud, 'switch', '-q', 'main')
    const order = (await checkOrders({ ...ctx, now: true })).orders.find((o) => o.branch === 'omni/orders/hooked')!
    await until((await runOrder(shop, order.branch, { tool: 'Claude Code', sha: order.sha }, ctx)).id, (r) => r.status === 'finished')
    assert.match(await git(shop, 'log', '-1', '--format=%B', order.branch), /Omni-Status: done/)
    assert.ok(!existsSync(marker), `hooks ran: ${existsSync(marker) && readFileSync(marker, 'utf8')}`)
  } finally {
    await git(shop, 'config', '--unset', 'core.hooksPath')
  }
})

test('a Codex question waits for your click', async () => {
  await push('omni/orders/q-codex', 'Anything?', 'Omni-To: Codex', 'Omni-Status: open', 'Omni-Ask: docs')
  const q = (await checkOrders({ repos, api, now: true, cmd: [process.execPath, [agent, 'read']] })).orders.find((o) => o.branch === 'omni/orders/q-codex')!
  assert.equal(q.state, 'open')
  assert.equal(q.run, undefined)
  assert.match(q.note!, /click/)
})
