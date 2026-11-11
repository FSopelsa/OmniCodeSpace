import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Tool } from './runs.ts'
import { frontmatter } from './setup.ts'

export type Template = { id: string; name: string; description: string; tool: Tool | ''; model: string; from: 'Omni' | 'project'; body: string }

// Omni's own templates. A project's .omni/templates/<id>.md replaces the one with the same id.
const BUILT_IN = join(import.meta.dirname, '..', 'templates')
// The id is the file name, so only plain names: a run names a template, never a path.
const ID = /^[\w-]+$/

async function read(dir: string, from: Template['from']): Promise<Template[]> {
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.md') && ID.test(basename(f, '.md')))
  return Promise.all(
    files.map(async (f) => {
      const { fields, body } = frontmatter(await readFile(join(dir, f), 'utf8'))
      const tool = fields.tool === 'Claude Code' || fields.tool === 'Codex' ? fields.tool : ''
      return { id: basename(f, '.md'), name: fields.name || basename(f, '.md'), description: fields.description ?? '', tool, model: fields.model ?? '', from, body }
    }),
  )
}

export async function templates(repo: string, builtIn = BUILT_IN) {
  const all = new Map<string, Template>()
  for (const t of [...(await read(builtIn, 'Omni')), ...(await read(join(repo, '.omni', 'templates'), 'project'))]) all.set(t.id, t)
  return [...all.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function template(repo: string, id: unknown, builtIn = BUILT_IN) {
  const found = (await templates(repo, builtIn)).find((t) => t.id === id)
  if (!found) throw new Error('No template with that name in Omni or this project.')
  return found
}

export const withTemplate = (t: Template, task: string) => `${t.body}\n\n## Your task\n\n${task}`
