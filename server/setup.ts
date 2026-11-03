import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { normal } from './sessions.ts'

export type AgentDef = {
  tool: 'Claude Code' | 'Codex'
  name: string
  from: string
  file: string
  description: string
  model: string
  // Claude Code: the tools it may use, empty meaning all. Codex: its sandbox, empty meaning the session's.
  tools: string[]
  sandbox: string
  instructions: string
}
export type Named = { name: string; from: string }
export type Rules = { from: string; mode: string; allow: string[]; ask: string[]; deny: string[]; dirs: string[] }

const readText = (file: string) => readFile(file, 'utf8').then((t) => t.replace(/^\uFEFF/, '')).catch(() => '')
async function readJson(file: string): Promise<any> {
  try {
    return JSON.parse(await readText(file))
  } catch {
    return {}
  }
}
const unquote = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, '$2')
const list = (v = '') => v.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean)

// shortcut: reads flat `key: value` lines, simple lists and block text, which is what agent and skill files use. Swap for a YAML library if one needs nesting.
export function frontmatter(text: string) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[^\n]*\n?([\s\S]*)$/.exec(text)
  if (!m) return { fields: {} as Record<string, string>, body: text.trim() }
  const fields: Record<string, string> = {}
  let key = ''
  let block = false
  for (const line of m[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z_-]+):\s*(.*)$/.exec(line)
    if (pair) {
      key = pair[1]
      block = /^[|>]-?$/.test(pair[2].trim())
      fields[key] = block ? '' : unquote(pair[2])
    } else if (key && /^\s+-\s+/.test(line) && !block) {
      fields[key] = [fields[key], unquote(line.replace(/^\s+-\s+/, ''))].filter(Boolean).join(', ')
    } else if (key && block && line.trim()) {
      fields[key] = [fields[key], line.trim()].filter(Boolean).join(' ')
    }
  }
  return { fields, body: m[2].trim() }
}

// TOML table names can quote their parts, as in projects.'C:\work' or plugins."a@b".
export const keyPath = (name: string) =>
  [...name.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|([^.\s]+)/g)].map((m) => (m[1] !== undefined ? JSON.parse(`"${m[1]}"`) : (m[2] ?? m[3])))

function tomlValue(v: string) {
  const basic = /^"((?:[^"\\]|\\.)*)"/.exec(v)
  if (basic) return JSON.parse(`"${basic[1]}"`) as string
  const literal = /^'([^']*)'/.exec(v)
  if (literal) return literal[1]
  return v.replace(/\s+#.*$/, '')
}

// shortcut: reads [table] headers, one-line `key = value` pairs and triple-quoted text, enough for the settings shown here. Swap for a TOML library if more is needed.
export function toml(text: string) {
  const tables = new Map<string, Record<string, string>>([['', {}]])
  let table = tables.get('')!
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\[\[/.test(lines[i])) {
      table = {}
      continue
    }
    const header = /^\s*\[([^[\]]+)\]\s*(#.*)?$/.exec(lines[i])
    if (header) {
      const name = header[1].trim()
      if (!tables.has(name)) tables.set(name, {})
      table = tables.get(name)!
      continue
    }
    const pair = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(lines[i])
    if (!pair) continue
    const value = pair[2].trim()
    const quote = value.slice(0, 3)
    if (quote === '"""' || quote === "'''") {
      const parts: string[] = []
      let rest = value.slice(3)
      while (!rest.includes(quote) && i + 1 < lines.length) {
        parts.push(rest)
        rest = lines[++i]
      }
      const end = rest.indexOf(quote)
      parts.push(end < 0 ? rest : rest.slice(0, end))
      table[pair[1]] = parts.join('\n').replace(/^\n/, '').trim()
    } else {
      table[pair[1]] = tomlValue(value)
    }
  }
  return tables
}

const names = (servers: unknown, from: string): Named[] => (servers && typeof servers === 'object' ? Object.keys(servers).map((name) => ({ name, from })) : [])

async function folders(dir: string) {
  return (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
}

// A skill is a top-level folder holding SKILL.md. Searching deeper finds the examples some skills bundle.
async function skillsIn(dir: string, from: string, prefix = ''): Promise<Named[]> {
  return (await folders(dir)).filter((name) => existsSync(join(dir, name, 'SKILL.md'))).map((name) => ({ name: prefix + name, from }))
}

async function claudeUserSkills(home: string) {
  const dir = join(home, '.claude', 'skills')
  const synced = await Promise.all((await folders(join(dir, 'synced'))).map((bucket) => skillsIn(join(dir, 'synced', bucket), 'synced from claude.ai')))
  return [...(await skillsIn(dir, 'user')), ...synced.flat()]
}

async function claudeAgents(dir: string, from: string, prefix = ''): Promise<AgentDef[]> {
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.md'))
  return Promise.all(
    files.map(async (f) => {
      const { fields, body } = frontmatter(await readText(join(dir, f)))
      const name = prefix + (fields.name || basename(f, '.md'))
      return { tool: 'Claude Code', name, from, file: join(dir, f), description: fields.description ?? '', model: fields.model ?? '', tools: list(fields.tools), sandbox: '', instructions: body } as AgentDef
    }),
  )
}

async function codexAgents(dir: string, from: string): Promise<AgentDef[]> {
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.toml'))
  return Promise.all(
    files.map(async (f) => {
      const t = toml(await readText(join(dir, f))).get('')!
      return { tool: 'Codex', name: t.name || basename(f, '.toml'), from, file: join(dir, f), description: t.description ?? '', model: t.model ?? '', tools: [], sandbox: t.sandbox_mode ?? '', instructions: t.developer_instructions ?? '' } as AgentDef
    }),
  )
}

// Plugins come with their own agents, skills and MCP servers, so they count for both questions: who's here, and what they can touch.
async function claudePlugins(repo: string, home: string, settings: any[]) {
  // Later settings files override earlier ones, as in Claude Code.
  const enabled: Record<string, unknown> = Object.assign({}, ...settings.map((s) => s.enabledPlugins ?? {}))
  const installed = (await readJson(join(home, '.claude', 'plugins', 'installed_plugins.json'))).plugins ?? {}
  return Object.entries(enabled)
    .filter(([, on]) => on === true)
    .flatMap(([id]) => {
      const entry = (installed[id] ?? []).find((e: any) => e.scope === 'user' || normal(e.projectPath ?? '') === normal(repo))
      return entry ? [{ id, name: id.split('@')[0], path: entry.installPath as string }] : []
    })
}

// What agents are defined for this repo, and what they can touch. Only names leave this function, never MCP commands, arguments or environment values.
export async function setup(repo: string, home = homedir()) {
  const sources = [
    ['user settings', join(home, '.claude', 'settings.json')],
    ['project settings', join(repo, '.claude', 'settings.json')],
    ['local settings', join(repo, '.claude', 'settings.local.json')],
  ]
  const settings = await Promise.all(sources.map(([, file]) => readJson(file)))
  const plugins = await claudePlugins(repo, home, settings)
  const claudeJson = await readJson(join(home, '.claude.json'))
  const project: any = Object.entries(claudeJson.projects ?? {}).find(([path]) => normal(path) === normal(repo))?.[1] ?? {}

  const rules: Rules[] = sources.map(([from], i) => {
    const p = settings[i].permissions ?? {}
    return { from, mode: p.defaultMode ?? '', allow: p.allow ?? [], ask: p.ask ?? [], deny: p.deny ?? [], dirs: p.additionalDirectories ?? [] }
  })
  if (project.allowedTools?.length) rules.push({ from: 'approved in earlier sessions', mode: '', allow: project.allowedTools, ask: [], deny: [], dirs: [] })

  const pluginMcp = await Promise.all(
    plugins.map(async (p) => {
      const manifest = await readJson(join(p.path, '.claude-plugin', 'plugin.json'))
      const servers = { ...(await readJson(join(p.path, '.mcp.json'))).mcpServers, ...(typeof manifest.mcpServers === 'object' ? manifest.mcpServers : {}) }
      return names(servers, `plugin ${p.name}`)
    }),
  )

  const codexConfig = toml(await readText(join(home, '.codex', 'config.toml')))
  const codexProject = toml(await readText(join(repo, '.codex', 'config.toml')))
  const codexTop = { ...codexConfig.get(''), ...codexProject.get('') }
  const tablesOf = (config: Map<string, Record<string, string>>, first: string) =>
    [...config].map(([name, values]) => ({ path: keyPath(name), values })).filter((t) => t.path.length === 2 && t.path[0] === first)

  const agents = (
    await Promise.all([
      claudeAgents(join(repo, '.claude', 'agents'), 'project'),
      claudeAgents(join(home, '.claude', 'agents'), 'user'),
      ...plugins.map((p) => claudeAgents(join(p.path, 'agents'), `plugin ${p.name}`, `${p.name}:`)),
      codexAgents(join(repo, '.codex', 'agents'), 'project'),
      codexAgents(join(home, '.codex', 'agents'), 'user'),
    ])
  ).flat()

  return {
    agents,
    claude: {
      rules: rules.filter((r) => r.mode || r.allow.length || r.ask.length || r.deny.length || r.dirs.length),
      mcp: [...names(claudeJson.mcpServers, 'user'), ...names(project.mcpServers, 'local'), ...names((await readJson(join(repo, '.mcp.json'))).mcpServers, 'project .mcp.json'), ...pluginMcp.flat()],
      skills: (
        await Promise.all([
          skillsIn(join(repo, '.claude', 'skills'), 'project'),
          claudeUserSkills(home),
          ...plugins.map((p) => skillsIn(join(p.path, 'skills'), `plugin ${p.name}`, `${p.name}:`)),
        ])
      ).flat(),
      plugins: plugins.map((p) => p.id),
    },
    codex: {
      sandbox: codexTop.sandbox_mode ?? '',
      approval: codexTop.approval_policy ?? '',
      network: (codexProject.get('sandbox_workspace_write') ?? codexConfig.get('sandbox_workspace_write'))?.network_access ?? '',
      trust: tablesOf(codexConfig, 'projects').find((t) => normal(t.path[1]) === normal(repo))?.values.trust_level ?? '',
      mcp: [...tablesOf(codexConfig, 'mcp_servers').map((t) => ({ name: t.path[1], from: 'user config' })), ...tablesOf(codexProject, 'mcp_servers').map((t) => ({ name: t.path[1], from: 'project config' }))],
      skills: (await Promise.all([skillsIn(join(repo, '.agents', 'skills'), 'project'), skillsIn(join(home, '.agents', 'skills'), 'user'), skillsIn(join(home, '.codex', 'skills'), 'user')])).flat(),
      plugins: tablesOf(codexConfig, 'plugins').filter((t) => t.values.enabled === 'true').map((t) => t.path[1]),
    },
  }
}

export type Setup = Awaited<ReturnType<typeof setup>>
