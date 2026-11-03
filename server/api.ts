import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { catchup, findRepos, repoDetail, repoSummary } from './git.ts'
import { allSessions, sessionsIn } from './sessions.ts'
import { setup } from './setup.ts'

const roots = () => (process.env.OMNI_ROOTS ?? join(homedir(), 'IdeaProjects')).split(delimiter).filter(Boolean)

const LOCAL_HOST = /^(127\.0\.0\.1|localhost)(:\d+)?$/
const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.mcp.json', '.claude/settings.json']

async function instructions(repo: string) {
  const found = INSTRUCTION_FILES.filter((f) => existsSync(join(repo, f)))
  for (const dir of ['.claude/agents', '.claude/skills']) {
    const names = await readdir(join(repo, dir)).catch(() => [])
    found.push(...names.map((n) => `${dir}/${n}`))
  }
  return found
}

// The browser names a repo, and only repos found under the roots are ever opened.
async function knownRepo(path: string | null) {
  const repos = await findRepos(roots())
  if (!path || !repos.includes(path)) throw Object.assign(new Error('That folder is not a repo in this workspace.'), { status: 404 })
  return path
}

async function route(url: URL) {
  const path = url.searchParams.get('path')
  switch (url.pathname) {
    case '/repos': {
      const repos = await findRepos(roots())
      return { roots: roots(), repos: await Promise.all(repos.map(repoSummary)) }
    }
    case '/repo': {
      const repo = await knownRepo(path)
      const detail = await repoDetail(repo)
      return {
        ...detail,
        sessions: sessionsIn(await allSessions(), detail.worktrees.map((w) => w.path).concat(repo)),
        instructions: await instructions(repo),
      }
    }
    case '/setup':
      return setup(await knownRepo(path))
    case '/catchup':
      return catchup(await knownRepo(path), url.searchParams.get('agent') ?? '')
    default:
      throw Object.assign(new Error('No such route.'), { status: 404 })
  }
}

// Read-only on purpose: nothing here changes a repo, so a stray request can't do damage.
export function api(req: IncomingMessage, res: ServerResponse) {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  // Any web page can aim requests at localhost. The host check stops DNS rebinding, the origin check stops other sites.
  const { host = '', origin } = req.headers
  if (!LOCAL_HOST.test(host) || (origin && new URL(origin).host !== host)) return send(403, { error: 'Only this PC can use this API.' })
  if (req.method !== 'GET') return send(405, { error: 'This API is read-only.' })
  route(new URL(req.url ?? '/', 'http://localhost'))
    .then((body) => send(200, body))
    .catch((e) => send(e.status ?? 400, { error: e.message }))
}
