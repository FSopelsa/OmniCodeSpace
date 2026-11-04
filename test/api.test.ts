import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { api, token } from '../server/api.ts'

const root = mkdtempSync(join(tmpdir(), 'omni-root-'))
mkdirSync(join(root, 'shop', '.git'), { recursive: true })
mkdirSync(join(root, 'plain'))
process.env.OMNI_ROOTS = root
after(() => rmSync(root, { recursive: true, force: true }))

function call(url: string, headers: Record<string, string> = { host: '127.0.0.1:5173' }, method = 'GET', text = '') {
  return new Promise<{ status: number; body: any }>((resolve) => {
    let status = 0
    const res = {
      writeHead: (code: number) => { status = code },
      end: (text: string) => resolve({ status, body: JSON.parse(text) }),
    }
    // The body, read the way a real request is.
    const body = async function* () {
      if (text) yield text
    }
    api({ url, headers, method, [Symbol.asyncIterator]: body } as unknown as IncomingMessage, res as unknown as ServerResponse)
  })
}

test('refuses requests that did not come from this PC', async () => {
  assert.equal((await call('/repos', { host: 'evil.example' })).status, 403)
  assert.equal((await call('/repos', { host: '127.0.0.1.evil.example:5173' })).status, 403)
  assert.equal((await call('/repos', { host: '127.0.0.1:5173', origin: 'https://evil.example' })).status, 403)
})

test('writes need the page token, and other methods are refused', async () => {
  assert.equal((await call('/runs', undefined, 'POST')).status, 403)
  assert.equal((await call('/repos', undefined, 'PUT')).status, 405)
})

const send = (url: string, body: object) => call(url, { host: '127.0.0.1:5173', 'x-omni-token': token }, 'POST', JSON.stringify(body))

test('order routes are writes, so they need the page token, and take only order branches', async () => {
  for (const route of ['/orders/check', '/orders/run', '/orders/send']) assert.equal((await call(route, undefined, 'POST')).status, 403, route)
  assert.deepEqual((await send('/orders/check', {})).body.orders, [])
  const bad = await send('/orders/run', { repo: join(root, 'shop'), branch: 'main', tool: 'Claude Code' })
  assert.deepEqual([bad.status, bad.body.error], [400, "That isn't an order branch."])
  assert.equal((await send('/orders/send', { repo: join(root, 'plain'), branch: 'omni/orders/x' })).status, 404)
  assert.equal((await send('/orders/nope', {})).status, 404)
})

test('starting a run takes only the tool, task and model from the request', async () => {
  const { body } = await send('/runs', { repo: join(root, 'shop'), tool: 'Claude Code', task: 'x', branch: 'omni/orders/x' })
  assert.match(body.error, /no commits yet/)
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
