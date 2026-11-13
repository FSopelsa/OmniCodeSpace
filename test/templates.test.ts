import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { template, templates, withTemplate } from '../server/templates.ts'

const root = mkdtempSync(join(tmpdir(), 'omni-templates-'))
const builtIn = join(root, 'built-in')
const repo = join(root, 'shop')
const own = join(repo, '.omni', 'templates')
mkdirSync(builtIn, { recursive: true })
mkdirSync(own, { recursive: true })
after(() => rmSync(root, { recursive: true, force: true }))

const file = (dir: string, name: string, fields: string, body: string) => writeFileSync(join(dir, name), `---\n${fields}\n---\n${body}\n`)
file(builtIn, 'reviewer.md', 'name: Reviewer\ndescription: Reviews the branch.\ntool: Codex\nmodel: gpt-6.1-terra', '## Role & Identity\nYou review.')
file(builtIn, 'docs.md', 'name: Docs writer\ndescription: Writes docs.\ntool: Gemini', '## Role & Identity\nYou write docs.')
file(own, 'reviewer.md', 'name: Shop reviewer\ndescription: Our own review rules.', '## Role & Identity\nYou review the shop.')
file(own, 'bad name.md', 'name: Skipped', 'Never listed')
writeFileSync(join(own, 'notes.txt'), 'not a template')
// Can't be read as a file, and must not hide the readable templates.
mkdirSync(join(own, 'folder.md'))

test('lists Omni templates, a project file replaces one with the same name, and odd files are skipped', async () => {
  const list = await templates(repo, builtIn)
  assert.deepEqual(list.map((t) => [t.id, t.name, t.from]), [['docs', 'Docs writer', 'Omni'], ['reviewer', 'Shop reviewer', 'project']])
  // A tool other than Claude Code or Codex is dropped rather than passed on.
  assert.equal(list[0].tool, '')
  assert.equal(list[1].body, '## Role & Identity\nYou review the shop.')
})

test('reads tool and model from a template, and a project without templates gets Omni\'s', async () => {
  const [docs, reviewer] = await templates(join(root, 'empty'), builtIn)
  assert.equal(docs.id, 'docs')
  assert.deepEqual([reviewer.tool, reviewer.model], ['Codex', 'gpt-6.1-terra'])
})

test('finds a template only by a listed name, so a path cannot reach other files', async () => {
  assert.equal((await template(repo, 'docs', builtIn)).name, 'Docs writer')
  for (const id of ['../built-in/docs', 'bad name', 'missing', undefined]) await assert.rejects(template(repo, id, builtIn), /No template/)
})

test('puts the template ahead of the task', async () => {
  const t = await template(repo, 'docs', builtIn)
  assert.equal(withTemplate(t, 'Update the README'), '## Role & Identity\nYou write docs.\n\n## Your task\n\nUpdate the README')
})
