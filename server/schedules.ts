import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { toml } from './setup.ts'

export type Schedule = { tool: string; name: string; rule: string; active: boolean; file: string }

// Codex keeps each automation in its own folder. Claude's desktop app keeps a scheduled-tasks.json,
// but it was empty on the PC this was built on, so its format is unknown and it isn't read yet.
export async function schedules(home = homedir()): Promise<Schedule[]> {
  const dir = join(home, '.codex', 'automations')
  const ids = await readdir(dir).catch(() => [])
  const found = await Promise.all(
    ids.map(async (id) => {
      const file = join(dir, id, 'automation.toml')
      const text = await readFile(file, 'utf8').catch(() => '')
      const root = toml(text).get('')!
      return root.rrule ? [{ tool: 'Codex', name: root.name || id, rule: root.rrule, active: root.status === 'ACTIVE', file }] : []
    }),
  )
  return found.flat()
}
