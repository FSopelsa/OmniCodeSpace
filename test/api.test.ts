import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { api } from '../server/api.ts'

const root = mkdtempSync(join(tmpdir(), 'omni-root-'))
mkdirSync(join(root, 'shop', '.git'), { recursive: true })
mkdirSync(join(root, 'plain'))
process.env.OMNI_ROOTS = root
after(() => rmSync(root, { recursive: true, force: true }))

function call(url: string, headers: Record<string, string> = { host: '127.0.0.1:5173' }, method = 'GET') {
  return new Promise<{ status: number; body: any }>((resolve) => {
    let status = 0
    const res = {
      writeHead: (code: number) => { status = code },
      end: (text: string) => resolve({ status, body: JSON.parse(text) }),
    }
    api({ url, headers, method } as unknown as IncomingMessage, res as unknown as ServerResponse)
  })
}

test('refuses requests that did not come from this PC', async () => {
  assert.equal((await call('/repos', { host: 'evil.example' })).status, 403)
  assert.equal((await call('/repos', { host: '127.0.0.1.evil.example:5173' })).status, 403)
  assert.equal((await call('/repos', { host: '127.0.0.1:5173', origin: 'https://evil.example' })).status, 403)
})

test('is read-only', async () => {
  assert.equal((await call('/repos', undefined, 'POST')).status, 405)
})

test('only opens folders found under the roots', async () => {
  const listed = await call('/repos')
  assert.equal(listed.status, 200)
  assert.deepEqual(listed.body.repos.map((r: { name: string }) => r.name), ['shop'])

  for (const path of [root, join(root, 'plain'), 'C:\\Windows', '']) {
    for (const route of ['/repo', '/setup']) assert.equal((await call(`${route}?path=${encodeURIComponent(path)}`)).status, 404, `${route} ${path}`)
  }
  assert.equal((await call('/nope')).status, 404)
})

test('a bad agent name is a clear error', async () => {
  const path = encodeURIComponent(join(root, 'shop'))
  const { status, body } = await call(`/catchup?path=${path}&agent=..%2Fmain`)
  assert.equal(status, 400)
  assert.match(body.error, /Agent names use/)
})
