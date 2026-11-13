import { parseArgs } from 'node:util'
import { disable, enable } from './enable.ts'
import { arrive, catchup, markSeen } from './git.ts'

const USAGE = `Usage, from inside any git repo:
  omni enable                   Catch up Claude Code and Codex automatically in this repo
  omni enable --orders          Also take orders from agents elsewhere (see README)
  omni disable                  Undo enable: the hook, the notes, the git config and refs/omni
  omni catchup --agent <name>   Print what changed since this agent last looked
  omni seen --agent <name>      Record that this agent is now up to date
  omni arrive --agent <name>    Print any news, then record the agent as up to date
  omni hook --agent <name>      The same, for a session-start hook that passes JSON on stdin

Add --repo <path> to point at another repo.`

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { agent: { type: 'string' }, repo: { type: 'string' }, orders: { type: 'boolean' } },
})
const [command] = positionals
const repo = values.repo ?? process.cwd()

if (command !== 'enable' && command !== 'disable' && (!values.agent || !['catchup', 'seen', 'arrive', 'hook'].includes(command))) {
  console.error(USAGE)
  process.exit(2)
}
const agent = values.agent ?? ''

try {
  if (command === 'enable') {
    const { repo: root, changed } = await enable(repo, { orders: values.orders })
    console.log(changed.length ? `Turned on catch-up in ${root}, changing: ${changed.join(', ')}` : `Catch-up was already on in ${root}.`)
    console.log('New sessions there catch up from now on. Review AGENTS.md and commit it if you want to keep the note.')
  } else if (command === 'disable') {
    const { repo: root, changed, kept } = await disable(repo)
    console.log(changed.length ? `Turned off catch-up in ${root}, changing: ${changed.join(', ')}` : `Catch-up was already off in ${root}.`)
    if (kept.length) console.log(`Left alone because you edited them: ${kept.join(', ')}`)
  } else if (command === 'hook') {
    let input = ''
    if (!process.stdin.isTTY) for await (const chunk of process.stdin) input += chunk
    // Windows PowerShell puts a byte-order mark on what it pipes.
    const { session_id, cwd, source, prompt_cache_likely_expired, estimated_cache_write_usd } = JSON.parse(input.replace(/^﻿/, '') || '{}')
    const brief = await arrive(cwd ?? repo, agent, { id: session_id, source })
    // A resumed chat whose cache ran out pays to cache its whole history again, while a new chat only needs the brief.
    if (prompt_cache_likely_expired === true) {
      const cost = typeof estimated_cache_write_usd === 'number' ? ` (about $${estimated_cache_write_usd.toFixed(2)} at API prices)` : ''
      const systemMessage = `This chat's prompt cache has likely expired, so your next message pays to cache its whole history again${cost}. A new chat is usually cheaper, and it gets a short brief of what changed.`
      process.stdout.write(JSON.stringify({ systemMessage, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: brief } }))
    } else process.stdout.write(brief)
  } else if (command === 'arrive') {
    process.stdout.write(await arrive(repo, agent))
  } else if (command === 'catchup') {
    const brief = await catchup(repo, agent)
    process.stdout.write(brief.text)
    console.error(`\nAbout ${brief.briefTokens} tokens here, against about ${brief.projectTokens} to read every tracked text file.`)
  } else {
    console.log(`${agent} is up to date at ${(await markSeen(repo, agent)).slice(0, 7)}.`)
  }
} catch (e) {
  console.error((e as Error).message)
  // A session must still start if its hook fails, for example outside a git repo.
  process.exit(command === 'hook' ? 0 : 1)
}
