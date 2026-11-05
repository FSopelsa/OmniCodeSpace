import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { catchup, git, markSeen } from '../server/git.ts'
import { applyChange, codeTodos, editTodo, shareTodo, todo } from '../server/todo.ts'

Object.assign(process.env, { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' })
const root = mkdtempSync(join(tmpdir(), 'omni-todo-'))
after(() => rmSync(root, { recursive: true, force: true }))
// Built from parts, so scanning OmniCodeSpace itself doesn't list these fixtures.
const TAG = 'TO' + 'DO'
const FIX = 'FIX' + 'ME'

test('edits change one line and keep the rest of the file', () => {
  const file = '# Shop\r\n\r\nNotes stay.\r\n\r\n- [ ] Fix login\r\n- [x] Add cart\r\n\r\nMore notes.\r\n'
  const added = applyChange(file, { op: 'add', text: '  Write\n the   docs ' })
  assert.equal(added, '# Shop\r\n\r\nNotes stay.\r\n\r\n- [ ] Fix login\r\n- [x] Add cart\r\n- [ ] Write the docs\r\n\r\nMore notes.\r\n')
  const ticked = applyChange(added, { op: 'toggle', line: 4, expect: 'Fix login' })
  assert.match(ticked, /- \[x\] Fix login\r\n/)
  assert.match(applyChange(ticked, { op: 'toggle', line: 5, expect: 'Add cart' }), /- \[ \] Add cart\r\n/)
  assert.equal(applyChange(ticked, { op: 'remove', line: 6, expect: 'Write the docs' }), file.replace('[ ] Fix', '[x] Fix'))

  assert.equal(applyChange('', { op: 'add', text: 'First' }), '# To-do\n\n- [ ] First\n')
  assert.equal(applyChange('# Plans\n', { op: 'add', text: 'First' }), '# Plans\n\n- [ ] First\n')
})

test('edits refuse a stale line and empty or long text', () => {
  const file = '- [ ] One\n- [ ] Two\n'
  assert.throws(() => applyChange(file, { op: 'remove', line: 0, expect: 'Two' }), (e: any) => e.status === 409)
  assert.throws(() => applyChange(file, { op: 'toggle', line: '0', expect: 'One' }), (e: any) => e.status === 409)
  assert.throws(() => applyChange(file, { op: 'add', text: '   ' }), /Write what needs doing/)
  assert.throws(() => applyChange(file, { op: 'add', text: 'x'.repeat(301) }), /under 300/)
  assert.throws(() => applyChange(file, { op: 'rename', line: 0, expect: 'One' }), /add, toggle or remove/)
})

const shop = join(root, 'shop')
const remote = join(root, 'remote.git')

test('code comments are found, and prose, headings and the list itself are not', async () => {
  await git(root, 'init', '-q', '-b', 'main', shop)
  writeFileSync(join(shop, 'app.ts'), `const ${TAG}_A = 1 // ${TAG}: check a\r\n/* ${FIX}(felix) the leak */\nconst ${TAG}S = 2\n`)
  writeFileSync(join(shop, 'run.py'), `# ${TAG} retry on timeout\nprint("${TAG}")\n`)
  writeFileSync(join(shop, 'README.md'), `## ${TAG}\n\nWe keep a ${TAG} list.\n<!-- ${TAG}: screenshots -->\n`)
  writeFileSync(join(shop, 'TODO.md'), `- [ ] Fix login // ${TAG}: not this\n`)
  await git(shop, 'add', '.')
  await git(shop, 'commit', '-q', '-m', 'First')
  assert.deepEqual(await codeTodos(shop), [
    { file: 'README.md', line: 4, tag: TAG, text: 'screenshots' },
    { file: 'app.ts', line: 1, tag: TAG, text: 'check a' },
    { file: 'app.ts', line: 2, tag: FIX, text: 'the leak' },
    { file: 'run.py', line: 1, tag: TAG, text: 'retry on timeout' },
  ])
})

test('sharing commits only the list and pushes it, and says what is in the way', async () => {
  writeFileSync(join(shop, 'app.ts'), 'staged but not shared\n')
  await git(shop, 'add', 'app.ts')
  let view = await editTodo(shop, { op: 'add', text: 'Ship it' })
  assert.deepEqual(view.items.map((i) => i.text), ['Fix login // ' + TAG + ': not this', 'Ship it'])
  assert.equal(view.share.changed, true)
  assert.equal(view.share.remote, false)

  // With no remote, a commit is all there is to do.
  assert.equal((await shareTodo(shop)).share.changed, false)
  assert.equal(await git(shop, 'log', '-1', '--format=%s'), 'Update TODO.md')
  assert.equal(await git(shop, 'status', '--porcelain'), 'M  app.ts')

  await git(root, 'init', '-q', '--bare', remote)
  await git(shop, 'remote', 'add', 'origin', remote)
  await editTodo(shop, { op: 'add', text: 'Tell the team' })
  await assert.rejects(shareTodo(shop), /isn't on a remote yet, so push it once yourself: git push -u origin main/)
  await editTodo(shop, { op: 'remove', line: 2, expect: 'Tell the team' })
  await git(shop, 'commit', '-q', '-m', 'Not yet', '--', 'TODO.md')
  await git(shop, 'push', '-q', '-u', 'origin', 'main')
  view = await editTodo(shop, { op: 'toggle', line: 1, expect: 'Ship it' })
  assert.equal(view.share.upstream, 'origin/main')
  view = await shareTodo(shop)
  assert.deepEqual(view.share, { changed: false, upstream: 'origin/main', ahead: 0, unpushed: false, remote: true, branch: 'main' })
  assert.match(await git(remote, 'show', 'main:TODO.md'), /- \[x\] Ship it/)
})

test('a returning agent hears what changed on the list', async () => {
  await markSeen(shop, 'tester')
  await editTodo(shop, { op: 'add', text: 'Add search' })
  await editTodo(shop, { op: 'remove', line: 0, expect: (await todo(shop)).items[0].text })
  await git(shop, 'commit', '-q', '-m', 'Plan search', '--', 'TODO.md')
  const { text } = await catchup(shop, 'tester')
  assert.match(text, /## To-do changes in TODO\.md\nOthers wrote these too\.\n```diff\n-- \[ \] Fix login.*\n\+- \[ \] Add search\n```/)
  assert.equal(readFileSync(join(shop, 'TODO.md'), 'utf8'), '- [x] Ship it\n- [ ] Add search\n')
})
