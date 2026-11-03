import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { catchup, git, markSeen, repoDetail } from '../server/git.ts'

let repo: string

async function commit(file: string, ...messages: string[]) {
  writeFileSync(join(repo, file), `${file} ${Math.random()}\n`)
  await git(repo, 'add', '.')
  await git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', ...messages.flatMap((m) => ['-m', m]))
}

before(async () => {
  repo = mkdtempSync(join(tmpdir(), 'omni-'))
  await git(repo, 'init', '-b', 'main')
})
after(() => rmSync(repo, { recursive: true, force: true }))

test('a repo with no commits gives a brief, not an error', async () => {
  const brief = await catchup(repo, 'builder')
  assert.match(brief.text, /no commits yet/)
  assert.deepEqual((await repoDetail(repo)).commits, [])
  await assert.rejects(markSeen(repo, 'builder'), /no commits/)
})

test('first visit says there is no record', async () => {
  await commit('a.txt', 'First')
  const brief = await catchup(repo, 'builder')
  assert.equal(brief.seen, '')
  assert.match(brief.text, /No earlier visit/)
  assert.ok(brief.projectTokens > 0)
})

test('returning agent gets only what changed, with agent and why', async () => {
  const seen = await markSeen(repo, 'builder')
  assert.match((await catchup(repo, 'builder')).text, /Nothing has been committed since/)

  await commit('b.txt', 'Add b', 'Agent: Local builder\nWhy: plan step 2')
  const brief = await catchup(repo, 'builder')
  assert.equal(brief.seen, seen)
  assert.equal(brief.commits, 1)
  assert.equal(brief.files, 1)
  assert.match(brief.text, /Add b \[Local builder\] Why: plan step 2/)
  assert.match(brief.text, /b\.txt/)
  assert.doesNotMatch(brief.text, /First/)
})

test('a co-author line names the agent when there is no Agent trailer', async () => {
  await commit('c.txt', 'Add c', 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')
  const { commits } = await repoDetail(repo)
  assert.equal(commits[0].agent, 'Claude Opus 5.5')
  assert.equal(commits[0].parents.length, 1)
})

test('rewritten history compares from the last shared commit', async () => {
  await markSeen(repo, 'rebaser')
  await git(repo, 'reset', '--hard', 'HEAD~1')
  await commit('d.txt', 'Add d')
  const brief = await catchup(repo, 'rebaser')
  assert.match(brief.text, /no longer in this branch's history/)
  assert.match(brief.text, /Add d/)
  assert.equal(brief.news, true)
})

test('a huge change still gives a brief that fits a hook', async () => {
  await markSeen(repo, 'bulk')
  for (let i = 0; i < 60; i++) writeFileSync(join(repo, `many-${i}.txt`), 'x\n')
  await commit('why.txt', 'Add many files', `Why: ${'long reason '.repeat(1000)}`)
  const brief = await catchup(repo, 'bulk')
  assert.ok(brief.text.length < 10000, `${brief.text.length} characters`)
  assert.equal(brief.files, 61)
  assert.match(brief.text, /Cut short\. Run git log/)
})

test('seen refs are listed and bad agent names are refused', async () => {
  const { seen } = await repoDetail(repo)
  assert.deepEqual(seen.map((s) => s.agent).sort(), ['builder', 'bulk', 'rebaser'])
  for (const bad of ['', '../main', '-x', 'a b', 'a..b']) {
    await assert.rejects(catchup(repo, bad), /Agent names use/)
  }
})
