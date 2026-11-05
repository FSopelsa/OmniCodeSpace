import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { delimiter, join } from 'node:path'
import { catchup, findRepos, repoDetail, repoSummary } from './git.ts'
import { ORDER_BRANCH, checkOrders, runOrder, sendOrder } from './orders.ts'
import { schedules } from './schedules.ts'
import { allSessions, projectOf, sessionsIn } from './sessions.ts'
import { answerRun, askRun, listRuns, reviewRun, startRun, stopRun, watchRun } from './runs.ts'
import { setup } from './setup.ts'
import { remotes, stack } from './stack.ts'
import { editTodo, shareTodo, todo } from './todo.ts'

// Made fresh each time the server starts, and put into the page. Every write needs it.
export const token = randomBytes(24).toString('hex')

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

// A branch name goes into folder names and git arguments, so only order branches get through.
function orderBranch(branch: unknown) {
  if (typeof branch !== 'string' || !ORDER_BRANCH.test(branch)) throw new Error("That isn't an order branch.")
  return branch
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
    case '/roster': {
      const [repos, sessions] = await Promise.all([findRepos(roots()), allSessions()])
      // Two days back covers "today" in any time zone the browser is in.
      const recent = sessions.filter((s) => !s.parent && Date.now() - Date.parse(s.last) < 2 * 86_400_000)
      return { host: hostname(), sessions: recent.map((s) => ({ ...s, project: projectOf(s.cwd, repos) })), schedules: await schedules() }
    }
    case '/setup':
      return setup(await knownRepo(path))
    case '/map': {
      const repo = await knownRepo(path)
      const [built, linked] = await Promise.all([stack(repo), remotes(repo)])
      return { stack: built, remotes: linked }
    }
    case '/todo':
      return todo(await knownRepo(path))
    case '/runs':
      return listRuns()
    case '/runs/review':
      return reviewRun(url.searchParams.get('id'))
    case '/catchup':
      return catchup(await knownRepo(path), url.searchParams.get('agent') ?? '')
    default:
      throw Object.assign(new Error('No such route.'), { status: 404 })
  }
}

async function write(path: string, body: any, req: IncomingMessage) {
  // An agent's gate hook can only ask, with its own run's key. Everything else needs the page's token.
  if (path === '/runs/ask') return { allow: await askRun(body.run, body.key, body.command) }
  if (req.headers['x-omni-token'] !== token) throw Object.assign(new Error('Reload the page: the server has restarted since it loaded.'), { status: 403 })
  const self = `http://${req.headers.host}/api`
  switch (path) {
    case '/runs':
      // Only these fields: the rest of startRun's options are for orders, set on the server.
      return startRun(await knownRepo(body.repo), { tool: body.tool, task: body.task, model: body.model }, self)
    case '/todo':
      return editTodo(await knownRepo(body.repo), body)
    case '/todo/share':
      return shareTodo(await knownRepo(body.repo))
    case '/runs/stop':
      return stopRun(body.id)
    case '/runs/answer':
      return answerRun(body.id, body.allow === true)
    case '/orders/check':
      return checkOrders({ repos: await findRepos(roots()), api: self, now: body.now === true })
    case '/orders/run':
      return runOrder(await knownRepo(body.repo), orderBranch(body.branch), { tool: body.tool, model: body.model, sha: String(body.sha) }, { repos: await findRepos(roots()), api: self })
    case '/orders/send':
      return sendOrder(await knownRepo(body.repo), orderBranch(body.branch), await findRepos(roots()))
    default:
      throw Object.assign(new Error('No such route.'), { status: 404 })
  }
}

async function readBody(req: IncomingMessage) {
  let text = ''
  for await (const chunk of req) {
    text += chunk
    if (text.length > 100_000) throw Object.assign(new Error('That request is too large.'), { status: 413 })
  }
  return JSON.parse(text || '{}')
}

// Server-sent events: the run's lines so far, then each change as it happens.
function stream(id: string | null, req: IncomingMessage, res: ServerResponse) {
  let sent = 0
  const push = () => {
    while (sent < watched.run.lines.length) res.write(`data: ${JSON.stringify({ line: watched.run.lines[sent++] })}

`)
    res.write(`data: ${JSON.stringify({ run: { ...watched.run, lines: [] } })}

`)
  }
  const watched = watchRun(id, push)
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  push()
  req.on('close', watched.stop)
}

// Reads are open to this PC. Writes start agents, so they need the page's token.
export function api(req: IncomingMessage, res: ServerResponse) {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  // Any web page can aim requests at localhost. The host check stops DNS rebinding, the origin check stops other sites.
  const { host = '', origin } = req.headers
  if (!LOCAL_HOST.test(host) || (origin && new URL(origin).host !== host)) return send(403, { error: 'Only this PC can use this API.' })
  const url = new URL(req.url ?? '/', 'http://localhost')
  const done = (work: Promise<unknown>) => work.then((body) => send(200, body)).catch((e) => send(e.status ?? 400, { error: e.message }))
  if (req.method === 'POST') return done(readBody(req).then((body) => write(url.pathname, body, req)))
  if (req.method !== 'GET') return send(405, { error: 'Only GET and POST are used here.' })
  if (url.pathname === '/runs/events') {
    try {
      return stream(url.searchParams.get('id'), req, res)
    } catch (e: any) {
      return send(e.status ?? 400, { error: e.message })
    }
  }
  done(route(url))
}
