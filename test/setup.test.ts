import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { frontmatter, keyPath, setup, toml } from '../server/setup.ts'

const work = mkdtempSync(join(tmpdir(), 'omni-setup-'))
const home = join(work, 'home')
const repo = join(work, 'Shop')
const plugin = join(home, '.claude', 'plugins', 'cache', 'market', 'helper', '1.0.0')
after(() => rmSync(work, { recursive: true, force: true }))

function put(file: string, content: string | object) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
}

put(join(repo, '.claude', 'agents', 'builder.md'), '---\nname: builder\ndescription: >\n  Makes small changes\n  and commits them.\ntools:\n  - Read\n  - Bash(git *)\nmodel: sonnet\n---\n\nYou are Builder.\n')
put(join(repo, '.claude', 'settings.local.json'), { permissions: { deny: ['Bash(git push *)'] } })
put(join(home, '.claude', 'settings.json'), { enabledPlugins: { 'helper@market': true, 'off@market': false }, permissions: { allow: ['Read'], defaultMode: 'acceptEdits' }, env: { API_KEY: 'secret-env' } })
put(join(home, '.claude', 'plugins', 'installed_plugins.json'), {
  plugins: { 'helper@market': [{ scope: 'user', installPath: plugin }], 'off@market': [{ scope: 'user', installPath: join(work, 'off') }] },
})
put(join(plugin, 'agents', 'reviewer.md'), '---\ndescription: "Reviews diffs"\ntools: Read, Grep\n---\nReview carefully.')
put(join(plugin, 'skills', 'tidy', 'SKILL.md'), '---\nname: tidy\n---\n')
put(join(plugin, 'skills', 'tidy', 'examples', 'nested', 'SKILL.md'), 'an example, not a skill')
put(join(home, '.claude', 'skills', 'synced', 'bucket-1', 'notes', 'SKILL.md'), '---\nname: notes\n---\n')
put(join(plugin, '.mcp.json'), { mcpServers: { tracker: { command: 'tracker', env: { TOKEN: 'secret-token' } } } })
put(join(work, 'off', 'agents', 'ghost.md'), '---\nname: ghost\n---\n')
put(join(home, '.claude.json'), { projects: { [repo.replaceAll('\\', '/')]: { allowedTools: ['Bash(npm test)'], mcpServers: { db: { env: { PASSWORD: 'hunter2' } } } } } })

put(
  join(home, '.codex', 'config.toml'),
  [
    'approval_policy = "on-request"',
    "sandbox_mode = 'workspace-write' # comment",
    '[sandbox_workspace_write]',
    'network_access = false',
    `[projects.'${repo.toLowerCase()}']`,
    'trust_level = "trusted"',
    '[mcp_servers.search]',
    'command = "search"',
    '[mcp_servers.search.env]',
    'KEY = "secret-key"',
    '[plugins."docs@openai"]',
    'enabled = true',
    '[plugins."old@openai"]',
    'enabled = false',
  ].join('\n'),
)
put(join(home, '.codex', 'agents', 'reviewer.toml'), 'name = "reviewer"\ndescription = "Reads and reviews"\nsandbox_mode = "read-only"\ndeveloper_instructions = """\nReview the diff.\nNever edit files.\n"""\n')
put(join(home, '.agents', 'skills', 'caveman', 'SKILL.md'), '---\nname: caveman\n---\n')
put(join(home, '.codex', 'skills', '.system', 'built-in', 'SKILL.md'), 'hidden')

test('frontmatter reads lists and folded text', () => {
  const { fields, body } = frontmatter('---\ntools: [Read, "Grep"]\ndescription: |\n  one\n  two\n---\nBody')
  assert.equal(fields.tools, '[Read, "Grep"]')
  assert.equal(fields.description, 'one two')
  assert.equal(body, 'Body')
  assert.deepEqual(frontmatter('no frontmatter').fields, {})
})

test('toml reads quoted table names, comments and triple-quoted text', () => {
  assert.deepEqual(keyPath(`projects.'C:\\work'`), ['projects', 'C:\\work'])
  assert.deepEqual(keyPath('projects."C:\\\\work".x'), ['projects', 'C:\\work', 'x'])
  const t = toml('a = "x # not a comment"\nb = 3 # comment\nc = \'\'\'\nline\n\'\'\'\n[[skills.config]]\npath = "ignored"')
  assert.deepEqual(t.get(''), { a: 'x # not a comment', b: '3', c: 'line' })
})

test('finds agent definitions in the project, the user folder and enabled plugins', async () => {
  const { agents } = await setup(repo, home)
  const byName = Object.fromEntries(agents.map((a) => [`${a.tool}:${a.name}`, a]))
  assert.deepEqual(Object.keys(byName).sort(), ['Claude Code:builder', 'Claude Code:helper:reviewer', 'Codex:reviewer'])

  const builder = byName['Claude Code:builder']
  assert.equal(builder.from, 'project')
  assert.equal(builder.description, 'Makes small changes and commits them.')
  assert.deepEqual(builder.tools, ['Read', 'Bash(git *)'])
  assert.equal(builder.instructions, 'You are Builder.')
  assert.equal(byName['Claude Code:helper:reviewer'].from, 'plugin helper')

  const codex = byName['Codex:reviewer']
  assert.equal(codex.sandbox, 'read-only')
  assert.equal(codex.instructions, 'Review the diff.\nNever edit files.')
})

test('reports what each tool can touch, by name only', async () => {
  const s = await setup(repo, home)
  assert.deepEqual(
    s.claude.rules.map((r) => [r.from, r.mode, r.allow, r.deny]),
    [
      ['user settings', 'acceptEdits', ['Read'], []],
      ['local settings', '', [], ['Bash(git push *)']],
      ['approved in earlier sessions', '', ['Bash(npm test)'], []],
    ],
  )
  assert.deepEqual(s.claude.mcp, [{ name: 'db', from: 'local' }, { name: 'tracker', from: 'plugin helper' }])
  assert.deepEqual(s.claude.skills, [{ name: 'notes', from: 'synced from claude.ai' }, { name: 'helper:tidy', from: 'plugin helper' }])
  assert.deepEqual(s.claude.plugins, ['helper@market'])

  assert.equal(s.codex.sandbox, 'workspace-write')
  assert.equal(s.codex.approval, 'on-request')
  assert.equal(s.codex.network, 'false')
  // Codex keeps project paths lowercased, so the match ignores case and slash direction.
  assert.equal(s.codex.trust, 'trusted')
  assert.deepEqual(s.codex.mcp, [{ name: 'search', from: 'user config' }])
  assert.deepEqual(s.codex.plugins, ['docs@openai'])
  assert.deepEqual(s.codex.skills, [{ name: 'caveman', from: 'user' }])

  assert.doesNotMatch(JSON.stringify(s), /secret|hunter2/)
})

test('a missing home or repo just means nothing set up', async () => {
  const s = await setup(join(work, 'nowhere'), join(work, 'nobody'))
  assert.deepEqual(s.agents, [])
  assert.deepEqual(s.claude, { rules: [], mcp: [], skills: [], plugins: [] })
  assert.equal(s.codex.trust, '')
})
