import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { git } from './git.ts'

const LANGUAGES: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', java: 'Java', kt: 'Kotlin',
  py: 'Python', cs: 'C#', xaml: 'XAML', go: 'Go', rs: 'Rust', rb: 'Ruby', php: 'PHP', swift: 'Swift', cpp: 'C++', c: 'C', h: 'C',
  html: 'HTML', css: 'CSS', scss: 'CSS', sql: 'SQL', vue: 'Vue', svelte: 'Svelte', dart: 'Dart', gd: 'GDScript', lua: 'Lua', sh: 'Shell', ps1: 'PowerShell',
}
const MANIFESTS = /^(package\.json|pom\.xml|build\.gradle(\.kts)?|requirements\.txt|pyproject\.toml|Cargo\.toml|go\.mod|.+\.csproj)$/

// shortcut: names dependencies from package.json, pom.xml, Gradle, requirements.txt and .csproj only. The other manifests are listed without them.
function dependencies(file: string, text: string): string[] {
  const all = (re: RegExp, group = 1) => [...text.matchAll(re)].map((m) => m[group])
  if (file === 'package.json') {
    try {
      const pkg = JSON.parse(text)
      return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    } catch {
      return []
    }
  }
  if (file === 'pom.xml') return all(/<dependency>[\s\S]*?<artifactId>([^<]+)<\/artifactId>/g)
  if (file.startsWith('build.gradle')) return all(/["']([\w.-]+):([\w.-]+):[^"']*["']/g, 2)
  if (file === 'requirements.txt') return text.split(/\r?\n/).map((l) => l.split(/[=<>~!;\[ #]/)[0].trim()).filter(Boolean)
  if (file.endsWith('.csproj')) return all(/PackageReference Include="([^"]+)"/g)
  return []
}

// What a project is built with: languages by tracked file count, and the dependencies its manifests name.
export async function stack(repo: string) {
  const files = (await git(repo, 'ls-files').catch(() => '')).split('\n').filter(Boolean)
  const counts = new Map<string, number>()
  for (const f of files) {
    const language = LANGUAGES[f.slice(f.lastIndexOf('.') + 1).toLowerCase()]
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1)
  }
  // Manifests at the root or one folder down, which covers a client and server side by side.
  const found = files.filter((f) => MANIFESTS.test(basename(f)) && f.split('/').length <= 2).slice(0, 8)
  return {
    languages: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, n]) => ({ name, files: n })),
    manifests: await Promise.all(found.map(async (file) => ({ file, dependencies: dependencies(basename(file), await readFile(join(repo, file), 'utf8').catch(() => '')) }))),
  }
}

// Remotes, with any login stripped from their URLs, and the branches that exist only on a remote, which is where cloud agents' work shows up.
export async function remotes(repo: string) {
  const [list, local, remote] = await Promise.all([
    git(repo, 'remote', '-v').catch(() => ''),
    git(repo, 'for-each-ref', 'refs/heads', '--format=%(refname:short)').catch(() => ''),
    git(repo, 'for-each-ref', 'refs/remotes', '--format=%(refname:short)').catch(() => ''),
  ])
  const urls = new Map<string, string>()
  for (const line of list.split('\n').filter(Boolean)) {
    const [name, url] = line.split(/\s+/)
    urls.set(name, url.replace(/\/\/[^/@]+@/, '//'))
  }
  const mine = new Set(local.split('\n'))
  const only = remote.split('\n').filter((r) => r && !r.endsWith('/HEAD') && !mine.has(r.slice(r.indexOf('/') + 1)))
  return [...urls].map(([name, url]) => ({ name, url, only: only.filter((r) => r.startsWith(`${name}/`)).map((r) => r.slice(name.length + 1)) }))
}
