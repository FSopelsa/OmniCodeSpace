import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { bandFile, readBand } from '../server/band.ts'

const HEADER = 'key,started,project,name,cost_usd,turns,agent_minutes,tokens_total,tokens_output,reuse_pct,reused,new,callers_open,tests,level,model'
const dir = mkdtempSync(join(tmpdir(), 'omni-band-'))
after(() => rmSync(dir, { recursive: true, force: true }))
const csv = (folder: string, ...rows: string[]) => writeFileSync(join(dir, bandFile(folder)), [HEADER, ...rows].join('\n') + '\n')

test('names a band file after its folder, with either slash', () => {
  assert.equal(bandFile('C:\\Users\\Felix\\IdeaProjects\\OmniCodeSpace'), 'C__Users_Felix_IdeaProjects_OmniCodeSpace.csv')
  assert.equal(bandFile('C:/Users/Felix/x'), 'C__Users_Felix_x.csv')
  // ponytail turns everything but letters, digits, '_', '.' and '-' into '_'.
  assert.equal(bandFile('C:\\My Projects\\Åsa (1)'), 'C__My_Projects__sa__1_.csv')
})

test('keeps older rows when ponytail has since added a column', () => {
  writeFileSync(join(dir, bandFile('C:/p/wider')), `${HEADER},extra\nk1,2026-11-05 01:29,P,Old row,1,1,1,1,1,,0,0,0,not run,full,\n`)
  assert.deepEqual(readBand(['C:/p/wider'], dir).map((t) => t.key), ['k1'])
})

test("also reads the file that ponytail's import names after the folder alone", () => {
  writeFileSync(join(dir, 'imported.csv'), `${HEADER}\nk9,2026-11-01 09:00,imported,From import,2,3,4,5,6,,0,0,0,,full,\n`)
  assert.deepEqual(readBand(['C:\\p\\imported', 'C:/p/other.worktrees/imported/'], dir).map((t) => [t.key, t.tests]), [['k9', '']])
})

test('reads quoted names, unknown costs and no reuse', () => {
  csv('C:/p/shop',
    'k1,2026-11-05 01:29,C:\\p\\shop,"Fix, then ""ship""",7.44,6,20.6,12022369,72626,25,4,12,1,74 passed,full,claude-opus-5-5',
    'k2,2026-11-05 02:00,C:\\p\\shop,No price,,2,1.0,100,10,,0,0,0,not run,full,')
  const [a, b] = readBand(['C:/p/shop'], dir)
  assert.deepEqual(a, { key: 'k1', started: '2026-11-05 01:29', name: 'Fix, then "ship"', cost: 7.44, turns: 6, minutes: 20.6, tokens: 12022369, output: 72626, reuse: 25, tests: '74 passed', level: 'full', model: 'claude-opus-5-5' })
  assert.equal(b?.cost, null)
  assert.equal(b?.reuse, null)
})

test('keeps a newline inside a quoted name', () => {
  csv('C:/p/lines', 'k1,2026-11-05 01:29,P,"two\nlines",1,1,1,1,1,,0,0,0,not run,full,')
  assert.equal(readBand(['C:/p/lines'], dir)[0]?.name, 'two\nlines')
})

test('skips short and garbled rows', () => {
  csv('C:/p/bad', 'k1,2026-11-05 01:29,P', 'k2,2026-11-05 01:29,P,Bad cost,abc,1,1,1,1,,0,0,0,not run,full,', 'k3,2026-11-05 01:29,P,Fine,1,1,1,1,1,,0,0,0,not run,full,')
  assert.deepEqual(readBand(['C:/p/bad'], dir).map((t) => t.key), ['k3'])
})

test('returns a task once across the project and its worktrees, oldest first', () => {
  csv('C:/p/main', 'k2,2026-11-06 10:00,P,Later,1,1,1,1,1,,0,0,0,not run,full,', 'k1,2026-11-05 10:00,P,Shared,1,1,1,1,1,,0,0,0,not run,full,')
  csv('C:/p/main.worktrees/x', 'k1,2026-11-05 10:00,P,Shared,1,1,1,1,1,,0,0,0,not run,full,')
  assert.deepEqual(readBand(['C:/p/main', 'C:/p/main.worktrees/x'], dir).map((t) => t.key), ['k1', 'k2'])
})

test('a missing, empty or header-only file has no tasks', () => {
  writeFileSync(join(dir, bandFile('C:/p/empty')), '')
  csv('C:/p/header')
  assert.deepEqual(readBand(['C:/p/missing', 'C:/p/empty', 'C:/p/header'], dir), [])
})
