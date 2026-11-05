import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TODO_FILE, git } from './git.ts'

export type Item = { line: number; done: boolean; text: string }
export type CodeTodo = { file: string; line: number; tag: string; text: string }
export type Change = { op?: unknown; line?: unknown; expect?: unknown; text?: unknown }

// GitHub's task list syntax, so the file reads the same on GitHub, in an editor and to a model.
const ITEM = /^(\s*[-*] \[)([ xX])(\] )(.*)$/
// A tag right after a comment marker. Plain prose that mentions the word isn't a comment.
const COMMENT = '(//|#|/\\*|\\*|<!--|--|;)[[:space:]]*(TODO|FIXME)([^A-Za-z0-9_]|$)'
const MAX_TEXT = 300
const MAX_CODE = 200

const conflict = (message: string) => Object.assign(new Error(message), { status: 409 })

export function parseItems(text: string): Item[] {
  return text.split(/\r?\n/).flatMap((line, i) => {
    const m = ITEM.exec(line)
    return m ? [{ line: i, done: m[2] !== ' ', text: m[4] }] : []
  })
}

// Edits one line and keeps the rest of the file, including notes, headings and line endings, as it was.
export function applyChange(file: string, change: Change) {
  const eol = file.includes('\r\n') ? '\r\n' : '\n'
  const lines = file ? file.split(/\r?\n/) : ['# To-do', '']
  const items = parseItems(lines.join('\n'))
  if (change.op === 'add') {
    const text = typeof change.text === 'string' ? change.text.replace(/\s+/g, ' ').trim() : ''
    if (!text) throw new Error('Write what needs doing first.')
    if (text.length > MAX_TEXT) throw new Error(`Keep a to-do under ${MAX_TEXT} characters. Put the details in the code or a doc.`)
    const after = items.at(-1)?.line
    if (after === undefined) {
      while (lines.length && !lines.at(-1)!.trim()) lines.pop()
      lines.push('', `- [ ] ${text}`, '')
    } else lines.splice(after + 1, 0, `- [ ] ${text}`)
    return lines.join(eol)
  }
  // The browser names a line and the text it showed there, so an edit never lands on a line that changed meanwhile.
  const item = items.find((i) => i.line === change.line)
  if (!item || item.text !== change.expect) throw conflict(`${TODO_FILE} changed since this list loaded. It shows the new version now, so try again.`)
  if (change.op === 'toggle') lines[item.line] = lines[item.line].replace(ITEM, (_, a, mark, b, text) => `${a}${mark === ' ' ? 'x' : ' '}${b}${text}`)
  else if (change.op === 'remove') lines.splice(item.line, 1)
  else throw new Error('Use add, toggle or remove.')
  return lines.join(eol)
}

// shortcut: tracked files only and the first 200 hits, so a repo full of vendored code may hide some, add a folder filter if that happens.
export async function codeTodos(repo: string): Promise<CodeTodo[]> {
  // git grep exits with 1 when nothing matches. JSON has no comments, only reports and data that quote them.
  const out = await git(repo, 'grep', '-z', '-n', '-I', '-E', '--no-color', '-e', COMMENT, '--', '.', `:!${TODO_FILE}`, ':!*.json').catch(() => '')
  return out.split('\n').flatMap((hit) => {
    const [file, line, content = ''] = hit.split('\0')
    // The marker again, so a name like TODO_LIST earlier on the line isn't taken for the tag.
    const m = /(?:\/\/|#|\/\*|\*|<!--|--|;)\s*(TODO|FIXME)(\([^)]*\))?:?\s*(.*)$/.exec(content.trimEnd())
    // An empty one is usually a Markdown heading, not a task.
    const text = m?.[3].replace(/\s*(\*\/|-->)\s*$/, '').trim()
    return text ? [{ file, line: Number(line), tag: m![1], text }] : []
  }).slice(0, MAX_CODE)
}

// What stands between this PC's list and everyone else's: uncommitted edits, then commits that aren't pushed.
export async function shareState(repo: string) {
  const changed = Boolean(await git(repo, 'status', '--porcelain', '--', TODO_FILE))
  const upstream = await git(repo, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}').catch(() => '')
  const ahead = upstream ? Number(await git(repo, 'rev-list', '--count', '@{upstream}..HEAD')) : 0
  const unpushed = upstream ? Boolean(await git(repo, 'log', '-1', '--format=%h', '@{upstream}..HEAD', '--', TODO_FILE)) : false
  const remote = Boolean(await git(repo, 'remote'))
  return { changed, upstream, ahead, unpushed, remote, branch: await git(repo, 'branch', '--show-current') }
}

export async function todo(repo: string) {
  const path = join(repo, TODO_FILE)
  const exists = existsSync(path)
  const [code, share] = await Promise.all([codeTodos(repo), shareState(repo)])
  return { file: TODO_FILE, exists, items: exists ? parseItems(readFileSync(path, 'utf8')) : [], code, share }
}

export async function editTodo(repo: string, change: Change) {
  const path = join(repo, TODO_FILE)
  writeFileSync(path, applyChange(existsSync(path) ? readFileSync(path, 'utf8') : '', change))
  return todo(repo)
}

// Commits only the list, even when other files are staged, then pushes the branch the way a plain git push would.
export async function shareTodo(repo: string) {
  if ((await shareState(repo)).changed) {
    await git(repo, 'add', '--', TODO_FILE)
    await git(repo, 'commit', '-q', '-m', `Update ${TODO_FILE}`, '--', TODO_FILE)
  }
  const { upstream, branch, remote } = await shareState(repo)
  if (!upstream && !remote) return todo(repo)
  if (!upstream) throw new Error(`Committed. This branch isn't on a remote yet, so push it once yourself: git push -u origin ${branch}`)
  try {
    await git(repo, 'push')
  } catch (e: any) {
    const message = String(e.stderr || e.message).trim()
    throw new Error(/rejected|non-fast-forward|fetch first/.test(message) ? `Committed, but ${upstream} has newer commits. Pull them, then push again.` : message)
  }
  return todo(repo)
}
