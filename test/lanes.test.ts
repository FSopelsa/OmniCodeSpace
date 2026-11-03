import assert from 'node:assert/strict'
import { test } from 'node:test'
import { layout } from '../src/lanes.ts'

const lanes = (commits: { sha: string; parents: string[] }[]) =>
  Object.fromEntries(layout(commits).placed.map((p) => [p.sha, p.lane]))

test('straight history stays on one lane, oldest on the left', () => {
  const { placed, lanes: total } = layout([
    { sha: 'c', parents: ['b'] },
    { sha: 'b', parents: ['a'] },
    { sha: 'a', parents: [] },
  ])
  assert.equal(total, 1)
  assert.deepEqual(placed.map((p) => [p.sha, p.x]), [['c', 2], ['b', 1], ['a', 0]])
})

test('a merged branch gets its own lane and the first-parent line stays straight', () => {
  const result = lanes([
    { sha: 'm', parents: ['a', 'b'] },
    { sha: 'b', parents: ['r'] },
    { sha: 'a', parents: ['r'] },
    { sha: 'r', parents: [] },
  ])
  assert.deepEqual(result, { m: 0, b: 1, a: 0, r: 0 })
})

test('merge edges are marked and parents outside the window are ignored', () => {
  const { edges } = layout([
    { sha: 'm', parents: ['a', 'b'] },
    { sha: 'b', parents: ['gone'] },
    { sha: 'a', parents: ['gone'] },
  ])
  assert.deepEqual(edges, [
    { from: 'a', to: 'm', merge: false },
    { from: 'b', to: 'm', merge: true },
  ])
})

test('two open branches do not share a lane', () => {
  const result = lanes([
    { sha: 'x', parents: ['r'] },
    { sha: 'y', parents: ['r'] },
    { sha: 'r', parents: [] },
  ])
  assert.notEqual(result.x, result.y)
})
