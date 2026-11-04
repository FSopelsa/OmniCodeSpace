import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { git } from '../server/git.ts'
import { remotes, stack } from '../server/stack.ts'

const repo = mkdtempSync(join(tmpdir(), 'omni-stack-'))
after(() => rmSync(repo, { recursive: true, force: true }))

test('names languages and dependencies, and remotes without their logins', async () => {
  await git(repo, 'init', '-b', 'main')
  mkdirSync(join(repo, 'server'))
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ dependencies: { react: '1' }, devDependencies: { vite: '1' } }))
  writeFileSync(join(repo, 'server', 'pom.xml'), '<project><parent><artifactId>boot-parent</artifactId></parent><dependencies><dependency><groupId>x</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>')
  writeFileSync(join(repo, 'a.ts'), '')
  writeFileSync(join(repo, 'b.tsx'), '')
  writeFileSync(join(repo, 'server', 'App.java'), '')
  await git(repo, 'add', '.')
  await git(repo, '-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'First')

  const built = await stack(repo)
  assert.deepEqual(built.languages, [{ name: 'TypeScript', files: 2 }, { name: 'Java', files: 1 }])
  assert.deepEqual(built.manifests, [
    { file: 'package.json', dependencies: ['react', 'vite'] },
    { file: 'server/pom.xml', dependencies: ['spring-boot-starter-web'] },
  ])

  await git(repo, 'remote', 'add', 'origin', 'https://felix:secret-token@github.com/felix/shop.git')
  await git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
  await git(repo, 'update-ref', 'refs/remotes/origin/claude/cloud-plan', 'HEAD')
  assert.deepEqual(await remotes(repo), [{ name: 'origin', url: 'https://github.com/felix/shop.git', only: ['claude/cloud-plan'] }])
})
