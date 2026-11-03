export type LaneCommit = { sha: string; parents: string[] }
export type Placed = { sha: string; x: number; lane: number }
export type Edge = { from: string; to: string; merge: boolean }

// Commits arrive newest first, and x grows towards the newest so the panel reads left to right.
export function layout(commits: LaneCommit[]) {
  const expected: (string | null)[] = []
  const placed: Placed[] = []
  const known = new Set(commits.map((c) => c.sha))
  const edges: Edge[] = []
  const free = () => {
    const i = expected.indexOf(null)
    return i === -1 ? expected.length : i
  }

  commits.forEach((commit, i) => {
    const taken = expected.indexOf(commit.sha)
    const lane = taken === -1 ? free() : taken
    expected.forEach((sha, l) => { if (sha === commit.sha) expected[l] = null })
    placed.push({ sha: commit.sha, x: commits.length - 1 - i, lane })

    commit.parents.filter((p) => known.has(p)).forEach((parent, n) => {
      edges.push({ from: parent, to: commit.sha, merge: n > 0 })
      const at = expected.indexOf(parent)
      // The first parent stays on this lane, so a branch's history reads as one straight track.
      if (n === 0 && !expected[lane] && (at === -1 || at > lane)) {
        if (at !== -1) expected[at] = null
        expected[lane] = parent
      } else if (at === -1) {
        expected[free()] = parent
      }
    })
  })
  return { placed, edges, lanes: Math.max(1, ...placed.map((p) => p.lane + 1)) }
}
