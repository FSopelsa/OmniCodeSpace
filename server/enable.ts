import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { git } from './git.ts'

const CLI = join(import.meta.dirname, 'cli.ts').replaceAll('\\', '/')
const CLAUDE_FILE = '.claude/settings.local.json'
const CLAUDE_COMMAND = 'git omni hook --agent claude-code'
const CODEX_COMMAND = 'git omni arrive --agent codex'
const TRAILERS = `When you commit, end the message with these two trailer lines, together in its last paragraph, so the next agent knows who changed what and why:

    Agent: <your tool, and your role if you have one>
    Why: <the reason for the change, in one line>
`
const AGENTS_NOTE = `## For agents working here

Codex: at the start of a session, run \`${CODEX_COMMAND}\` once. It prints what changed in this repo since you last looked, or nothing if nothing did. If the command fails, carry on.

${TRAILERS}`
const CLAUDE_NOTE = `## Commit trailers\n\n${TRAILERS}`
const ORDERS_NOTE = `## Sending work to the owner's PC

To hand a task to an agent on the owner's PC, push a branch named \`omni/orders/<short-id>\` to origin. If your git access only lets you push \`claude/*\` branches, push one of those instead. The branch's newest commit adds \`order.md\`, saying what to do and how, and ends its message with:

    Omni-To: Claude Code
    Omni-Status: open

Use \`Omni-To: Codex\` for Codex. To ask a read-only question about another of the owner's projects, also add \`Omni-Ask: <that project's folder name>\`. Commit any code the order needs on the same branch. The owner approves the order on their PC. The result comes back on the same branch as \`report.md\`, in a commit with \`Omni-Status: done\`.
`

function addClaudeHook(file: string) {
  let config: any = {}
  if (existsSync(file)) {
    try {
      config = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      throw new Error(`${file} isn't valid JSON, so it was left alone. Fix it and run this again.`)
    }
  }
  const groups = ((config.hooks ??= {}).SessionStart ??= [])
  if (groups.some((group: any) => group.hooks?.some((hook: any) => hook.command === CLAUDE_COMMAND))) return false
  groups.push({ hooks: [{ type: 'command', command: CLAUDE_COMMAND, timeout: 30 }] })
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)
  return true
}

// Checked by one line, since a checkout can turn the note's line endings into CRLF.
function addNote(file: string, note: string, marker: string) {
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (current.includes(marker)) return false
  writeFileSync(file, current ? `${current.trimEnd()}\n\n${note}` : note)
  return true
}

// Turns on catch-up for one repo. The path to this tool is machine-specific, so only the repo's untracked git config holds it.
export async function enable(folder: string, opts: { orders?: boolean } = {}) {
  const repo = await git(folder, 'rev-parse', '--show-toplevel')
  const changed: string[] = []
  if (addClaudeHook(join(repo, CLAUDE_FILE))) changed.push(CLAUDE_FILE)

  await git(repo, 'config', '--local', 'alias.omni', `!node "${CLI}"`)

  // A settings.local file is personal, so git shouldn't offer to commit it.
  const exclude = resolve(repo, await git(repo, 'rev-parse', '--git-path', 'info/exclude'))
  if (!(existsSync(exclude) && readFileSync(exclude, 'utf8').split(/\r?\n/).includes(CLAUDE_FILE))) {
    mkdirSync(dirname(exclude), { recursive: true })
    appendFileSync(exclude, `${CLAUDE_FILE}\n`)
  }

  if (addNote(join(repo, 'AGENTS.md'), AGENTS_NOTE, CODEX_COMMAND)) changed.push('AGENTS.md')
  // Claude Code's own AGENTS.md fallback didn't load reliably in testing, while an import from CLAUDE.md did.
  const claudeMd = join(repo, 'CLAUDE.md')
  if (existsSync(claudeMd) ? addNote(claudeMd, CLAUDE_NOTE, 'Agent: <your tool') : addNote(claudeMd, '@AGENTS.md\n', '@AGENTS.md')) changed.push('CLAUDE.md')

  if (opts.orders) {
    // Untracked, like the alias: only this PC fetches orders.
    await git(repo, 'config', '--local', 'omni.orders', 'true')
    if (addNote(join(repo, 'AGENTS.md'), ORDERS_NOTE, 'omni/orders/') && !changed.includes('AGENTS.md')) changed.push('AGENTS.md')
    // Cloud Claude sessions send most orders, and they read CLAUDE.md, which may not import AGENTS.md.
    const imports = readFileSync(claudeMd, 'utf8').includes('@AGENTS.md')
    if (!imports && addNote(claudeMd, ORDERS_NOTE, 'omni/orders/') && !changed.includes('CLAUDE.md')) changed.push('CLAUDE.md')
    changed.push('git config omni.orders')
  }
  return { repo, changed }
}
