import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ponytail's band keeps one row per task in a CSV per project folder. We only read it.
export type BandTask = {
  key: string; started: string; name: string; cost: number | null; turns: number; minutes: number
  tokens: number; output: number; reuse: number | null; tests: string; level: string; model: string
}

const BAND_DIR = join(homedir(), '.config', 'ponytail', 'band')

// ponytail's own rule (ledgerFile in its band): everything but letters, digits, '_', '.' and '-' becomes '_'.
export const bandFile = (folder: string) => `${folder.replace(/[^\w.-]/g, '_')}.csv`

// Quoted fields may hold commas, newlines and doubled quotes, as task names come from prompts.
function parseCsv(text: string) {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

// An empty field is "unknown", which is not the same as 0.
const optional = (s: string | undefined) => (s ? Number(s) : null)

function tasksIn(text: string): BandTask[] {
  const [header, ...rows] = parseCsv(text)
  if (!header) return []
  const col = (row: string[], name: string) => row[header.indexOf(name)]
  // No column-count check: ponytail rewrites the header when it adds a column but keeps older, shorter rows.
  // A row too short to have its numbers fails the finite check below instead.
  return rows.flatMap((row) => {
    if (!col(row, 'key')) return []
    const text = (name: string) => col(row, name) ?? ''
    const t: BandTask = {
      key: text('key'), started: text('started'), name: text('name'),
      cost: optional(col(row, 'cost_usd')), turns: Number(col(row, 'turns')), minutes: Number(col(row, 'agent_minutes')),
      tokens: Number(col(row, 'tokens_total')), output: Number(col(row, 'tokens_output')), reuse: optional(col(row, 'reuse_pct')),
      tests: text('tests'), level: text('level'), model: text('model'),
    }
    const numbers = [t.cost ?? 0, t.turns, t.minutes, t.tokens, t.output, t.reuse ?? 0]
    return numbers.every(Number.isFinite) ? [t] : []
  })
}

// The tasks of a project and its worktrees, each once, oldest first.
// The live band names a file after the full path on Windows; its import, and the band elsewhere, after the folder name alone.
export function readBand(folders: string[], dir = BAND_DIR): BandTask[] {
  const tasks = new Map<string, BandTask>()
  const names = folders.flatMap((f) => [f, f.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? f])
  for (const folder of new Set(names)) {
    let text = ''
    try { text = readFileSync(join(dir, bandFile(folder)), 'utf8') } catch { continue }
    for (const t of tasksIn(text)) if (!tasks.has(t.key)) tasks.set(t.key, t)
  }
  return [...tasks.values()].sort((a, b) => a.started.localeCompare(b.started))
}
