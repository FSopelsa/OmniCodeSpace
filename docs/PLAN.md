# OmniCodeSpace plan

A workspace for agents and the people controlling them: browse environments, projects and agents, see their scopes, what they're doing and have done, and let agents from different LLMs pass work to each other.

**Short version:** build on git, don't build a new format, and don't compete with the tools that already manage providers and configs. The missing piece is small: a view across everything, a record of who has seen what, and a safe way to hand over work.

Status of the claims here: "measured" means I ran it on real repos on this PC. "Reported" means it comes from web sources I read but didn't test. Decisions marked "my call" are yours to overrule.

## Is this basically git?

Mostly, yes, and that's the best thing about the idea. Your instinct is right for the things that are about the code. Git has no answer for the things that are about the agents.

| You want | Git already does it? | What's left to add |
|---|---|---|
| Same picture of a project for every agent | Yes, a commit SHA is exactly that | Nothing |
| See what changed since some point | Yes, `git log` and `git diff` | Nothing |
| Isolate parallel agents | Yes, worktrees | Starting and cleaning them up |
| Move work between machines and cloud | Yes, branches and remotes | A convention for "this branch is an order" |
| Remember why a change was made | Partly, commit messages and trailers | Getting agents to write them |
| Know what each agent last saw | No, but a ref can hold it | `refs/omni/seen/<agent>`, built |
| Know who's running right now, and where | No | Read tool logs, built for this PC |
| Instructions, skills, permissions, schedules | No, it just stores the files | Read and display them |
| Approvals before an agent acts | No | The app's job |
| Different LLMs talking live | No | Doesn't need to be live, see step 11 |

So the description "a git visualization tool connected to an agent admin tool" holds. One nuance: git is where agents leave results, not how you control a running one. Stopping an agent, or seeing that it's waiting for you, has to go through the tool running it.

## Do we need a new context format?

No. I'd skip it, for three reasons.

**Every LLM already reads markdown and git output well.** A new format would need teaching, and that teaching costs tokens in every prompt.

**Long context files can backfire.** A study of `AGENTS.md`-style files found they didn't generally raise task success and raised cost by over 20%. Project overviews weren't useful, and hand-written files beat generated ones ([arXiv 2602.11988](https://arxiv.org/pdf/2602.11988)). Later work reports mixed results, some with efficiency gains ([arXiv 2607.27250](https://arxiv.org/pdf/2607.27250)), and these benchmarks don't cover multi-repo or long-running work. So a generated "project image" that every agent loads at every start is the design to avoid.

**Your "image" idea works without one.** The image is a commit SHA. Comparing it with now is a `git diff`. All that was missing is a pointer per agent, plus a short brief assembled only when an agent returns. That's what `omni catchup` does.

### How big a brief is (measured)

I ran `catchup` on local clones of 11 of your repos, pretending the agent last looked 5 commits ago. Your real repos were not changed.

| Project size (tokens, all tracked text) | Brief | Raw diff of those 5 commits |
|---|---|---|
| 123,594 | 1,529 | 102,644 |
| 60,637 | 652 | 23,968 |
| 48,960 | 924 | 19,308 |
| 45,390 | 632 | 45,183 |
| 42,705 | 405 | 23,353 |
| 24,340 | 644 | 19,926 |
| 24,109 | 353 | 29,607 |
| 23,990 | 484 | 45,625 |
| 23,985 | 505 | 8,483 |
| 14,459 | 1,011 | 22,502 |
| 6,476 | 233 | 4,364 |

- The brief was 0.9% to 7% of the project, with a median of 1.9%.
- **Raw diffs aren't the cheap option you'd expect.** In 3 of 11 repos the diff of just 5 commits was bigger than the whole project. So the brief lists files and leaves diffs to be fetched when needed.
- On a tiny project the brief can cost more than reading everything (196 against 54 in the demo repo).

**What this doesn't prove.** Tokens are estimated at 4 characters each. A brief says what changed, not how the code works, and an agent will still open files. A real agent also wouldn't read every file. So these are bounds, not savings. Step 2 measured real sessions: the brief made agents right about what was new, but didn't make them cheaper.

### Two other findings on token spend

- **Resuming an old chat can be the expensive path.** In one real session in your logs, cached re-reading came to 20.5 million tokens, against 1.1 million new input and 70,000 output. Long chats keep paying for their own history, and prompt caches expire. Step 2b measured this. After a break, a fresh chat plus a brief cost about a third as much as resuming, and was equally right.
- **A different LLM can't use another's transcript anyway.** Text in the repo is the only memory they all share.

## How the pieces relate

This answers your earlier question about chats versus projects versus agents. They're different layers, and only one is really "the agent".

| Thing | What it is | Lives in |
|---|---|---|
| Place | Where work runs: this PC, a laptop, a cloud environment | The machine or service |
| Project copy | A repo or worktree in a place | Git |
| Agent | A lasting definition: name, instructions, skills, access, model | A file, such as `.claude/agents/builder.md` |
| Run | One chat or session, working as an agent, in a project copy | The tool's own logs |
| Order | A request from one agent to another | A git branch |

Treating a chat as an agent is what makes this confusing today: chats end and lose context, while an agent should outlast any one chat. When you describe the product, say "workspace for agents". A chat is just one run of an agent.

## What already exists

| Project | What it is | Relation to this |
|---|---|---|
| [CC Switch](https://ccswitch.io/en/) | Very popular MIT desktop app (Tauri 2, Rust, React, SQLite). Switches providers, syncs MCP, skills and prompts, shows sessions and usage, for 12 to 13 tools | **Complement, don't compete.** It answers "how is each tool set up?". Nothing I read shows it coordinating agents or using git as shared state. Don't rebuild this part |
| [Sugabots](https://github.com/nitrictech/sugabots) | MIT team chat where people and API-backed bots work together. Postgres, Docker, Bun | **Only a partial match.** Good ideas to borrow: pods, threads for bot-to-bot help, per-tool approval, routines. But it doesn't use git as shared state, and nothing I read shows it wrapping CLI agents |
| [Vibe Kanban](https://www.vibekanban.com/docs/getting-started) | Kanban board that runs agents in worktrees | Closest on control. Reportedly Apache-2.0, with the hosted product wound down (one source). Look here before step 7 |
| [Agent Console](https://awesome.ecosyste.ms/projects/github.com%2Fms2sato%2Fagent-console) | MIT browser dashboard for agents in worktrees. Tested on macOS and Claude Code | Similar start, small enough to read |
| [Swarm](https://hn.jakechampion.name/reader/https://github.com/penberg/swarm), [wt-tools](https://awesome.ecosyste.ms/projects/github.com%2Ftatargabor%2Fwt-tools) | Worktree managers with GUIs | Swarm is Linux-only. Good worktree reference |
| [Entire](https://github.com/entireio/cli) | MIT CLI that saves agent transcripts per commit under `refs/entire/checkpoints/` with a commit trailer | **Very close to your idea.** Reuse rather than build capture. Note it pushes transcripts to your remote |
| [Agent Trace](https://github.com/cursor/agent-trace) | Draft spec for marking which code came from AI | Follow it if attribution matters. Still an early RFC |
| [Beads](https://github.com/steveyegge/beads) | MIT task graph for agents, on Dolt, synced through git | Use if you want a shared task queue. Adds a database |
| [Agent Client Protocol](https://agentclientprotocol.com/) | Standard for clients to drive coding agents, JSON-RPC over stdio. Adapters exist for Claude and Codex | **The way to connect many LLMs properly**, see step 13. TypeScript SDK: `@agentclientprotocol/sdk`. Licence not checked |

**Claude's own features.** [Remote Control](https://code.claude.com/docs/en/remote-control) is a window from your phone or browser into a session on your machine, so it's you controlling one session, not agents ordering each other. [Agent teams](https://code.claude.com/docs/en/agent-teams) let Claude sessions message each other through local files, but they're experimental and Claude-only. Cross-session messaging exists too, and the tool notes in this app say cloud sessions can receive messages but can't send any back yet. That is the gap git fills in step 11.

## GUI alternatives

All three share one look: an enamel signal-box panel, where tracks are branches and lamps show where agents are. Plain words stay in the interface, so it's still agents and branches, not trains.

### A. Tracks: one project in depth (recommended, and what's built)

![Prototype A](prototypes/a-tracks.png)

Best for your main question: what's happening in this repo, and what's new since I looked? The shaded area is your "image" idea made visible.

### B. Roster: agents and their day

![Prototype B](prototypes/b-roster.png)

Best for "what are they all doing, and what's scheduled?". I'd add this as a second tab at step 6.

### C. Map: the whole workspace

![Prototype C](prototypes/c-map.png)

Best for explaining the system and following an order across machines. It shows git as the thing joining everything. It looks great but gets crowded with many projects, so build it last, if at all.

## Architecture

```text
 Browser UI (React)
      |  read-only HTTP on 127.0.0.1
 Local server (Node)
      |-- git CLI ............ repos, branches, worktrees, refs/omni/*
      |-- tool logs .......... ~/.claude/projects, ~/.codex/sessions
      |-- instruction files .. AGENTS.md, .claude/agents, .mcp.json
      '-- (later) agent runners, in worktrees, with approval

 Other machines and cloud sessions connect only through the git remote.
```

There's no database and no service of our own. Git and the tools' logs are the storage, which is why this stays cheap and works offline.

## Tech stack (my call)

| Part | Choice | Why |
|---|---|---|
| Language | TypeScript throughout | You know it, and the agent SDKs and ACP are TypeScript |
| Server | Node 24, built-in modules | Runs `.ts` directly, with no framework needed yet |
| UI | React, Vite, Tailwind | Your stack |
| Git access | The `git` command | Complete and exact. Libraries only cover part of it |
| Commit graph | About 30 lines of own code | Small, tested, and packages didn't clearly fit |
| Storage | None yet, then `node:sqlite` if needed | Built into Node, no dependency |
| Live updates | Polling every 5 seconds, then SSE | Enough until agents stream output |
| Starting agents | Each tool's own CLI first, ACP later | Same tools you already use |
| Remote access | Tailscale, if ever | Avoids building login and security |
| Packaging | None yet, see decision 4 | A browser tab is enough for now |

## Steps

Each step ends in something you can check. Stop whenever it's useful enough.

### Done (uncommitted)

**Step 0: read-only view and catch-up.** Works on your real repos.

**Step 1: automatic catch-up.** `omni enable` turns it on per repo, with 29 passing tests in total. *Checked with real sessions on temp repos, verified:*

- **Claude Code:** I resumed a chat after someone else's commit. With hooks off, it answered "I don't know". With the hook on, it named the commit, the agent and the reason, none of which it had been told.
- **Codex:** a new session given a neutral prompt ran the command by itself, in its normal sandbox, and reported the change and the reason.

Three things differ from the original sketch of this step:

- A repo-local git alias holds the path to the tool, so `AGENTS.md` stays safe to commit.
- A resumed Claude chat keeps its own pointer. Without one, a second chat moving the shared pointer would leave the first chat wrongly told that nothing had changed.
- **Codex hooks are real but not used yet.** Codex has `SessionStart` hooks in `.codex/hooks.json`, which would be neater. In one `codex exec` test the hook didn't fire, even with the project trusted for that run and the hook-trust check bypassed, and I didn't find out why. A second run with the bypass was refused by the safety check, so I left it. They need trusting through `/hooks` in Codex, so that's worth trying by hand before replacing the `AGENTS.md` note.

The Codex route only asks the agent to run the command, so unlike the Claude hook, it can't guarantee it happens.

**Step 2: real savings, measured.** The brief makes agents right about what's new, but it doesn't make them cheaper.

**Setup.** I ran 20 new Claude Code sessions (Sonnet, `claude -p`) on throwaway clones of two of your repos:

- **Workshop E-commerce Platform JPA:** last seen at the 29 Sep commit, with 6 new commits after it, 3 of them merges.
- **Poklone:** last seen before the August gap, with 5 new commits after it.

Each clone had a stand-in remote, so it looked up to date. Every session got the same prompt: new commits have landed since you last worked here, get up to speed, and give a handover covering what changed, why, and what looks risky. The hook ran in both arms. In the "without" arm it had nothing to say. Personal plugins were off, the tools were read-only, and the arms alternated so prompt caching favoured neither. I scored the answers against a rubric written before reading them, with the arms hidden. Brief answers name their starting commit, though, so the hiding only partly worked.

| Median of 5 runs | JPA, without | JPA, with brief | Poklone, without | Poklone, with brief |
|---|---|---|---|---|
| Cost per run at list price | $0.064 | $0.070 (+9%) | $0.078 | $0.073 (−6%) |
| All tokens processed | 151,030 | 80,183 (−47%) | 151,879 | 80,526 (−47%) |
| Uncached tokens (input, cache writes, output) | 10,470 | 13,342 (+27%) | 12,987 | 13,930 (+7%) |
| Turns | 4 | 3 | 4 | 4 |
| Seconds | 21 | 20 | 24 | 20 |
| **Knew what was new (of 5)** | **0** (3 said nothing new, 2 couldn't tell) | **5** | **0** (3 guessed the right start and said so, 2 said nothing new) | **5** |
| New commits described, average of 5 | 3.8 | 4.6 | 4.8 | 4.8 |
| Factual errors, total over 5 runs | 3 | 3 | 1 | 1 |

- **Tokens fell by half, but cost didn't.** The tokens the brief saves are cheap cached re-reads of the session's fixed context. The tokens it adds are the brief itself plus the diffs the agent still opens, and those are full price. With no brief, an agent simply runs `git log` and `git show`, which is cheap.
- **The real difference is correctness.** Without the brief, an agent has no way to know where it left off. Most reported "nothing new" while describing the very commits it was asked about. With the brief, every run named the right range.
- **Depth didn't change.** In JPA, an unmentioned starter swap in "Fixed some warnings" was the best finding. It was caught in 1 run with the brief and 2 without. Cost with the brief also varied less ($0.07–0.08 against $0.05–0.12 on Poklone).

**Verdict against the rule set in advance.** By cost, the brief saves under 30%, so it fails. The work didn't get worse, though: the "what's new" part went from wrong or unknown to right. **Decided: keep the brief**, as a correctness feature, and don't claim it saves tokens.

**Limits of this test:**

- One model, one tool and one kind of prompt, with 5 runs per cell.
- Each clone had a fresh reflog, which made it obvious no earlier session existed. A real repo's reflog might lead an agent to a better guess.
- With personal plugins on, fixed overhead grows, and percentages shrink further.
- If you tell the agent the range yourself, the correctness gap mostly goes away.
- Resuming an old chat against starting a fresh one is tested in step 2b, below.
- The runs went straight to Anthropic, not through a local proxy. The list price of all 22 runs, including the pilot, was about $1.70.

**Step 2b: Codex, Haiku, and resume against fresh, measured.** The same setup, clones and prompt as step 2, with 5 runs per cell and the arms alternating. The extra runs found the same thing. The brief makes every agent right about what's new, but cheaper only by Haiku's 14–17%. Once a chat's cache has expired, a fresh chat with the brief beats resuming.

| Median of 5 runs | JPA, without | JPA, with brief | Poklone, without | Poklone, with brief |
|---|---|---|---|---|
| **Haiku:** cost per run at list price | $0.007 | $0.006 (−17%) | $0.008 | $0.007 (−14%) |
| Haiku: all tokens processed | 200,977 | 129,136 (−36%) | 258,350 | 180,478 (−30%) |
| Haiku: uncached tokens | 17,909 | 17,569 (−2%) | 23,968 | 22,423 (−6%) |
| Haiku: turns | 8 | 4 | 6 | 5 |
| **Haiku: knew what was new (of 5)** | **0** (2 guessed right and said so, 3 couldn't tell) | **5** | **0** (all 5 guessed right and said so, 2 miscounted) | **5** |
| **Codex:** all tokens | 123,881 | 117,168 (−5%) | 129,166 | 147,494 (+14%) |
| Codex: uncached tokens (input not from cache, plus output) | 15,480 | 22,793 (+47%) | 11,252 | 25,423 (+126%) |
| Codex: commands run | 11 | 9 | 14 | 9 |
| Codex: ran the catch-up by itself (of 5) | 5 | 5 | 5 | 5 |
| **Codex: knew what was new (of 5)** | **0** (couldn't establish a start) | **5** | **0** (couldn't, and mixed in older work) | **5** |

| Median of 5 runs, Sonnet, both with the brief | JPA, new chat | JPA, resumed chat | Poklone, new chat | Poklone, resumed chat |
|---|---|---|---|---|
| Cost per run, cache still warm | $0.062 | $0.060 (−4%) | $0.094 | $0.086 (−8%) |
| Claude Code's estimate to rewrite the old chat's cache once it has expired | | +$0.17 (42,018 tokens) | | +$0.18 (44,665 tokens) |
| Cost per run, cache expired (estimate) | $0.062 | about $0.23, 3.7× | $0.094 | about $0.27, 2.8× |
| Knew what was new (of 5) | 5 | 5 | 5 | 5 |

- **Haiku:** the brief halved turns in JPA and saved 14–17% of cost, still under the 30% bar. Without it, Haiku guessed the starting point at best.
- **Codex runs the catch-up reliably.** It ran the command by itself in all 20 runs, because of the `AGENTS.md` note. It never established the range without the brief. With the brief, it ran fewer commands but read more full-price text, mostly diffs inside the range it now knew. So for Codex the brief costs more, and buys correctness.
- **Resume against fresh:** with a warm cache, they cost the same and were equally right. Claude Code flagged no expired cache in any of the 10 resumes, because each came within minutes of the old chat. Once the cache expires, after an hour at most, rewriting even this small 42k-token history makes resuming about 3× dearer than a fresh chat with the brief. Long real chats would cost more still. **So start fresh after a break, and resume only within the hour.** The hook now says so at the right moment. When Claude Code reports `prompt_cache_likely_expired` on resume, the hook shows you a message with Claude Code's cost estimate and suggests a new chat. The model still gets the brief. A run with the flag faked showed the brief reaching the model and the message leaving the hook. How the message looks in the interactive app is unchecked, because a real expiry takes up to an hour.

Limits of step 2b:

- **Fixed versions:** the Codex runs used your model (`gpt-6.1-terra`, high effort) without your `config.toml`, so they skipped the Headroom proxy and your hooks. The Claude runs loaded only local settings, so `rtk` and Headroom were off there too.
- **Haiku's refused commands:** 6 of Haiku's commands without the brief, in JPA, were refused by my test's permission list. These were compound `cd "$(…)"` lines, a PowerShell `Set-Location` and a GitHub search. That cost it turns and is why 3 runs couldn't tell what was new.
- **Coverage not compared:** it was counted by commit hashes named, which Codex rarely writes. Claude's counts were equal between arms (4.0 and 5.0 for Haiku, 5.0 for the resume test).
- **Cost accounting:** a resumed run's reported cost includes the old chat's own cost, which I subtracted. Expired-cache costs use Claude Code's own estimate. They weren't measured.
- **Total cost:** about $1.90 at list price for the Claude runs, including the two old chats. Codex used 2.5 million input tokens, 85% from cache, on your ChatGPT plan.

### Prove the idea

1. *(Done, see above.)*
2. *(Done, see above.)* Everything after this still holds, because the view doesn't depend on the brief.

2b. *(Done, see above.)* Codex, Haiku, and resume against fresh. Opus wasn't run.

### Ongoing: briefs that also save tokens

Step 2 showed where the cost really sits. The brief itself is small. What costs is the diffs an agent opens afterwards anyway, and those are read at full price. So a cheaper brief has to answer more of what the agent would otherwise go and read. Ideas to try, none tested:

- **Say why per file, not just per commit.** One line per changed file on what changed and why, so the agent opens fewer diffs. Trailers from step 3 feed this.
- **Let a cheap model write the summary.** For example, Haiku summarises the diffs once at commit or arrival time, so expensive models read the summary instead.
- **A handover note from the agent that leaves.** A `Stop` hook asks the agent to write a three-line note into the commit or a ref. That costs it a little and saves the next agent more.
- **Brief only when it pays.** On resume with a warm cache, the old chat already knows the history. Use `prompt_cache_likely_expired` to decide.
- **Fit the brief to the task.** When the first prompt names files or areas, put those first and leave the rest as one line.
- **Learn from the logs.** Record each brief's size and the reads that follow it in the session log. Compare brief formats and prompt styles over time, and keep what leads to fewer full-price reads.

**Keep searching for prior art**, and look again every few steps. Places to search:

- GitHub repos and published workflows.
- Claude Code and Codex plugins and skills. Use `/anthropic-skills:find-skills` and the plugin catalog.
- MCP servers.

Wording to try: agent handoff, session handover, context catch-up, onboarding an agent to a repo, codebase digest, repo map, memory bank, change summary, "what changed since", diff summarisation, context compression, context engineering.

#### Prior art, round 1 (3 Nov 2026, redone for "ready to code, cheaply")

The goal here is an agent that can start coding as soon and as cheaply as possible. "What changed since" matters less, because git already keeps it. So I looked for three things: the cheapest context that gets an agent going, whether handoff skills save tokens, and whether any commit history is worth putting in the brief. *Read* means I opened the source myself. *Claim* means a number or statement from a project's own page or a search summary, which I didn't check.

**Result**

- **No confirmed saving anywhere.** I found no test showing that a git catch-up brief or a handoff skill saves tokens. The one handoff measurement is tiny and mixed (below).
- **Orientation context doesn't buy much.** Beyond the study cited above, a later ablation of 288 runs on Claude Code and Codex found that context files didn't measurably change correctness, and that agents fail on implementation skill, not on missing repo knowledge (*read:* the [abstract of arXiv 2607.27250](https://arxiv.org/abs/2607.27250), not the paper). Claude Code's docs say to keep what an agent can't derive from the code (pitfalls, rationale, conventions that differ from defaults) and to cut directory layouts, dependency lists and architecture overviews (*read:* [memory docs](https://code.claude.com/docs/en/memory)).
- **In your repos, only dependency-file changes are worth pulling from history.** Counts below.

**Do handoff skills save tokens?** Not shown.

- *Read:* the only measurement I found, [claudetto's Handoff Cost page](https://github.com/xsyetopz/claudetto/wiki/Handoff-Cost) (Claude Code 2.1.303, Sonnet, 2 runs per arm, one toy project). Writing the handoff cost $0.0067 against $0.0163 for built-in `/compact`, and left about 500 tokens of context against 1,580. With the next turn counted, though, the handoff arm cost $0.061 against $0.046, because both handoff follow-ups re-read work that the note said was done. An older revision of that page, seen only in a search summary, showed handoff far cheaper ($0.063 against $0.229). I couldn't confirm it.
- **Where one should pay (my reasoning, not measured):** it lets you start a fresh chat after a break instead of resuming. Step 2b found fresh plus the brief about 3× cheaper than resuming once the cache has expired, and a note would carry what git can't: intent, decisions, the next step.
- *Read:* the `handoff` skills from [mattpocock](https://github.com/mattpocock/skills) (MIT; 1.1M installs is a claim from `npx skills find`) and [TheFlow0360](https://github.com/TheFlow0360/claude-handoff) (MIT, 0 stars). Neither publishes a token measurement. Worth taking: a note holds decisions and why, gotchas, open items and how to verify. It points to commits and diffs instead of repeating them, says what was checked so the next agent needn't redo it, and warns when `HEAD` moved after it was written. The community handoff plugins in the plugin catalog are the same idea (descriptions only, none read).

**Which commit history is worth extracting?** My `git log` counts for the three of your repos with 15 or more commits. They are small repos.

| Repo | Commits | Merges | Reverts | Renamed files | Commits touching dependency files | Commits over 30 files |
|---|---|---|---|---|---|---|
| Poklone | 21 | 0 | 0 | 0 | 5 | 1 |
| Project-test-1 | 17 | 2 | 0 | 0 | 2 | 0 |
| Workshop E-commerce Platform JPA | 40 | 10 | 0 | 0 | 4 | 0 |

- **Extract the changed lines of dependency files** (`pom.xml`, `package.json` and similar). They turn up in 10–24% of commits here. Step 2's best finding was a starter swap hidden in "Fixed some warnings", and it was caught in 1 run with the brief and 2 without, so the brief as built doesn't surface it.
- **Extract trailers.** `Why:` is already parsed. `Gotcha:` and `Next:` would be new lines in the `AGENTS.md` rule from step 3, so the next agent gets part of what a handoff note carries, with no new hook or file.
- **Don't build yet:** reverts and renames (none occurred), co-change coupling (code-maat's defaults need 5 shared revisions per file pair, per a reimplementation's docs, which 17–40 commits rarely reach), and anything an LLM writes.

**Shortlist to test with step 2's setup**, best first. Same clones, prompt and 30% rule as step 2, plus the tokens of every diff read after the brief.

1. **Brief = range pointer + extracts.** Cut it to the named range (`abc1234..def5678`, how many commits), the changed lines of dependency files, and any `Why:`, `Gotcha:` and `Next:` trailers. Agents run `git log` themselves if they want the list. Keep the named range, since it is what made agents right in step 2. The brief is already 1–7% of a project, so any saving has to come from fewer diff reads, and the extracts are the only part that could cause that.
2. **Handover note, upper bound first.** In the test clones, write the best note by hand (decisions and why, gotchas, open items, what was checked, nothing the commits already say) and see whether reads fall. Also measure what writing it costs and whether the next agent still re-reads finished work, which it did in 2 of 2 in claudetto's test. Build the `Stop` hook only if reads fall.
3. **Code index on or off (outside the brief).** Claude Code's docs say code-intelligence plugins give symbol navigation instead of text search, which reduces file reads (*read:* [costs docs](https://code.claude.com/docs/en/costs)). Measured claims for graph indexes are self-published: one DEV post says 38–64% fewer tokens across five repos with smaller cost savings, and a competitor says no cost saving (*claims*, from a search summary). `tokless index` builds a CodeGraph index. Per my notes, `tokless doctor` reported it missing for one project on 3 Nov, and I haven't rechecked. Run the step 2 clones with and without it.

Also before the next measurement: check whether the `rtk` hook is on in Claude Code (the binary is at `~/.local/bin/rtk`, the hook wasn't checked) and whether the session goes through Headroom. Either shrinks the `git show` output after the brief.

**Leads you listed**

- **Aider repo map.** Apache-2.0. *Read:* [docs](https://aider.chat/docs/repomap.html). Files with key symbols and signature lines, ranked by a file-dependency graph to fit a token budget (`--map-tokens`, default 1k). *Take:* budget the brief in tokens and rank what stays, because `catchup()` today cuts the tail at 9,500 characters. The map itself is orientation, so don't add one.
- **Cline Memory Bank.** Apache-2.0 (Cline). *Read:* [docs](https://docs.cline.bot/best-practices/memory-bank). Six hand-kept markdown files read at session start. *Take:* only the shape of `activeContext.md` (focus, recent changes, next steps) for the note. *Skip:* the static files restate what agents read anyway. *Claim:* a rival says Cline reads all six every session.
- **Repomix.** MIT. *Read:* [README](https://github.com/yamadashy/repomix). Packs a repo into one file, with `--compress` (signatures only), `--include-diffs`, `--include-logs` and per-file token counts. *Take:* nothing. It packs the whole repo, which is orientation, not a delta.
- **claude-mem.** Apache-2.0. *Read:* [progressive disclosure](https://docs.claude-mem.ai/progressive-disclosure) (partly), [file read gate](https://docs.claude-mem.ai/file-read-gate). An index of past work with token costs, and a gate that swaps whole-file reads of big files (32 KB and up) for outlines. *Take:* nothing now. *Not adopting:* a background worker and a tree-sitter download. *Claims:* an LLM call (Haiku by default) per tool use, from a search summary. Its 10–12× benchmark is its own and is about exploring code.
- **episodic-memory.** MIT, already yours. *Read:* README. Semantic search over past chats, used on demand. *Take:* nothing for the brief.
- **Caveman.** Apache-2.0. *Read:* README. A terse output voice, plus a "read less" compressor for logs and CSV. *Claim:* 33.2% fewer input tokens over whole sessions, HTML 9.9% worse. *Take:* nothing. The voice shrinks output, and my reading is that diffs aren't repetitive enough for the compressor.
- **Headroom.** Apache-2.0. *Read:* [README](https://github.com/headroomlabs-ai/headroom). A compressing proxy that keeps originals retrievable. *Claim:* 21–57% saved on four scenarios of its own. A test condition, not an idea.
- **rtk.** Apache-2.0 + BUSL-1.1 for the full build, Apache-2.0 for `rtk-oss`. *Read:* README. A hook shrinks `git log` and `git diff` output. Its README says the saving dilutes (bash output is part of the input, input is part of the bill), as step 2 found. A test condition, as above.

**Other finds**

- **git-prism.** Apache-2.0, 5 stars. *Read:* [README](https://github.com/mikelane/git-prism). An MCP server returning per-file and per-commit JSON: functions changed, imports, dependency changes. *Take:* dependency changes are a first-class item. The function-level part says what changed, which git holds, so it's off the shortlist for now. The README has no measured saving.
- **ai-memory** (akitaonrails). MIT. *Read:* parts of the README. Zero LLM calls on the default path, and a bounded brief. *Take:* deterministic first. It's a whole memory product, so not adopting.
- **Anthropic, [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).** *Read:* the sections on just-in-time loading and note-taking. Backs a brief of pointers plus a note.
- **Claude Code [costs docs](https://code.claude.com/docs/en/costs).** *Read:* `/clear` between tasks, `CLAUDE.md` under 200 lines, hooks that filter output before the model sees it, specific prompts. They also suggest a "codebase-overview" skill, which the studies above don't support.

**Seen only in search results, not read** (round 2)

- **sem** (Ataraxy Labs, entity-level diff CLI). Apache-2.0 per an aggregator. Its savings figures are from its author's Reddit posts.
- **Git Context Controller** (arXiv 2508.00031, *claim:* compressed recent context beat full-history dumps) and **Augment Context Lineage** (vendor blog: indexes commit history, a small LLM condenses diffs, fetched on demand).
- **claude-code-worklog** (an LLM summary at every session start), AgentDiffViewer, claude-remember, powercontext, memory-journal-mcp, phalanx-ai, and the dev.to piece on what `/compact` costs.
- **Code indexes:** CodeGraph, jCodeMunch and Serena. Savings are self-published, and I found no figures for Serena.
- **Catalogs:** `npx skills find` (run once, in the first pass) ranks `handoff` skills highest and found nothing for "what changed since". The MCP registry listed only hosted services, which I skipped because they'd send context off the machine, against decision 3.

**Limits.** Web search is US-only and mostly the quick mode. GitHub's API rate-limited me part-way, so a few licences come from `LICENSE` files or READMEs. Licences and star counts are as of 3 Nov 2026. The commit counts cover three small repos, and the handoff measurement has 2 runs per arm. Round 2: sem, ai-memory's `ARCHITECTURE.md`, the `rtk` and Headroom check, and a code index test.

### See everything

3. **Agent trailers.** Tell agents through `AGENTS.md` to add `Agent:` and `Why:`. *Done when: a week's commits carry them without reminders.* **Built and checked with real sessions. The week of real use is still to come.**
   - **What `enable` does:** it adds the rule to `AGENTS.md`. When the repo has no `CLAUDE.md`, it also creates one holding just `@AGENTS.md`. When the repo has one, it adds the rule there instead.
   - **Why the import:** Claude Code is meant to fall back to `AGENTS.md` when there's no `CLAUDE.md`, but in testing it loaded the file only some of the time. With the import, a normal Claude session and one started as Builder both wrote `Agent:` and `Why:` without being told.
   - **Codex:** it wrote both trailers by itself. Its sandbox then blocked the commit (`.git/index.lock`), so in normal use it would ask you first.
4. **Agents as real things.** Read definitions from `.claude/agents/*.md` and the Codex equivalent, and list runs under each. *Done when: the app shows Builder with its instructions, tools and past runs.* **Done, checked in the browser on a test repo with Builder and its 5 runs.**
   - **Definitions read:** project and user agents for Claude Code, plus agents from enabled plugins. For Codex, `.codex/agents/*.toml`.
   - **Claude runs:** a session started with `--agent` logs an `agent-setting` line, and a subagent's `.meta.json` names its type.
   - **Codex runs:** a spawned thread logs its `agent_role`.
   - **Built-in agents:** ones such as Explore have no file, so they're listed by their runs alone.
5. **Scope panel.** Show skills, MCP servers and permission settings per project. Check whether CC Switch's database can be read rather than parsing its files again. *Done when: you can answer "what can this agent touch?" from the UI.* **Done.**
   - **Claude Code:** permission rules from each settings file, plus tools approved in earlier sessions. Also MCP servers, skills and plugins.
   - **Codex:** sandbox, approvals, network, this project's trust, MCP servers, skills and plugins.
   - **Names only:** commands, arguments and environment values never leave the server, and a test checks it.
   - **CC Switch:** it isn't installed on this PC (no `~/.cc-switch`), so its database couldn't be checked. The files are read directly.
6. **Roster tab.** Prototype B, built from session timestamps plus scheduled tasks. Finding where schedules are stored is part of this step. *Done when: today's runs show correctly.*

### Start agents

7. **Run an agent in a new worktree.** `git worktree add`, then spawn the CLI (`claude -p` or `codex exec`). This is the first time the app writes, so it adds a per-launch API token and a confirm dialog first. Read Vibe Kanban's approach before starting. *Done when: you can start a task, see it finish and review the branch.*
8. **Live output and stop.** Stream output over SSE, with a stop button. *Done when: you can watch and stop a run.*
9. **Approval on risky actions.** Default to no push, and let the UI approve. *Done when: an agent can't push without your click.*
10. **Local and other models.** Add a local model through OpenCode and Ollama, as a third adapter. *Done when: the same task can run on Claude, Codex or a local model.*

### Pass work between agents

11. **Orders over git.** A cloud agent pushes `omni/orders/<id>` holding `order.md` (what to do, how, and attached code), with `Omni-To:` and `Omni-Status:` trailers. Your PC fetches on a timer and shows it under "Needs you". You approve, step 7 runs it, and the result goes back on the same branch. *Done when: your example works end to end: a Claude cloud session orders a local agent to implement its code, and you see the report.*
12. **Questions between projects.** The same mechanism for read-only requests such as "compare this with that project", which can run with less approval. *Done when: an agent can get an answer from another project.*

### Later, if it earns it

13. **Move to ACP** for richer control and more LLMs, once the CLI adapters feel limiting.
14. **Other machines.** Each machine pushes `refs/omni/status/<machine>`, so all of them appear in the tree with no server.
15. **Package it** (decision 4), and **Map view**.
16. **Optional integrations:** Entire checkpoints, Beads tasks.

## Decisions for you

Everything has a default, so none of these block step 1.

1. **Your own use or a product for others?** My default: yours first, public later. Team features bring logins and a real database, which is what makes Sugabots heavy.
2. **Which billing for agents the app starts?** This one needs care, see the first hurdle. My default: try your own subscription only through the official CLIs, after you've read the current terms, with an API key as the fallback.
3. **Should transcripts ever leave the machine?** My default: no. Only commit messages and trailers travel. Entire does push them, so using it means accepting that, and a public repo would expose them.
4. **Stay in the browser, or become a desktop app?** My default: browser until step 15. Then Tauri (small, and CC Switch proves it works) would need a Node sidecar or a Rust rewrite, while Electron (large) keeps all the code as is.
5. **Should `seen` refs be shared between machines?** My default: no, each machine tracks its own. Sharing is one push setting if you want it later.
6. **Open source, and which licence?** My default: MIT, once it's useful. I haven't checked whether the name OmniCodeSpace is taken.
7. **Which view next?** My default: Tracks stays home, Roster second.

## Hurdles

- **Terms of use (check before step 7).** Reports say Anthropic restricts subscription logins to its own products and has enforced this against third-party tools. Reports conflict on the Agent SDK and on `claude -p`, including one that describes a separate credit pool. I found nothing that settles whether a wrapper launching the official CLI is allowed, and I didn't read Anthropic's terms directly. Sources: [The Register](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access), [WinBuzzer](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/). Don't take this as legal advice. Read the current terms yourself.
- **Log formats can change.** Claude Code and Codex logs are internal, so an update could break the reader. The parsers skip what they don't know, and CC Switch's MIT parsers are a reference when that happens.
- **Cloud sessions are invisible locally.** Their logs aren't on this PC, and I found no public API listing them. You'd see only what they push, which is another reason orders use git.
- **Orders are untrusted input.** A branch that tells an agent what to do is a prompt-injection and remote-code path. Nothing runs without your approval, order text is treated as data, and only branches from your own remote count. Consider signed commits before ever allowing auto-run.
- **Briefs carry other people's words.** Catch-up puts commit messages into an agent's context automatically, and a hostile message could try to steer it. The brief tells the agent to treat them as information, which lowers the risk without removing it. Only enable catch-up in repos whose commits you already trust. Claude Code's own start-of-session git snapshot has a similar exposure.
- **Codex and `.git`.** OpenAI's docs say `.git` is read-only in the `workspace-write` sandbox. In my Windows test the pointer moved anyway, but a commit was blocked at `.git/index.lock`. If the pointer is blocked elsewhere, the brief still arrives and repeats next session until the pointer can move.
- **Merge conflicts.** Worktrees keep agents apart while working, and conflicts still arrive at merge time. Show them clearly, and let a person decide.
- **API relays.** Tools in this space promote third-party API relays. Sending your code through one is a privacy decision, and this app shouldn't suggest it.
- **Windows.** `node-pty` needs a native build if you want real terminals, so avoid it until needed. Agent teams' split panes don't support Windows Terminal.
- **Scope creep.** The largest risk is rebuilding CC Switch and Vibe Kanban. If a step duplicates them, link to them instead.

## Rough edges in the scaffold

- Labels can overlap a crossing track, and a label hides when there's no room. The commit list below always has the full names.
- The shaded "new" area follows commit time, so it isn't exactly `seen..HEAD`. The brief is the exact one.
- Only Claude Code and Codex logs are read, and repos are found one folder deep.
- Lamps only mean "log touched in the last 10 minutes". "Waiting for you" needs step 8.
- The API runs inside the Vite dev server, with no production build yet.
- A forked Claude chat starts from the tool's shared pointer, so it can miss changes its parent chat hadn't heard about. It stays silent rather than saying something false.
- `enable` has no undo command, and the README lists the manual steps. Per-chat refs are never pruned.
- **Plugin agents everywhere:** agents from user-level plugins appear in every repo, even if they never ran there.
- **Not read:** claude.ai connectors, managed company settings, and permissions set only on the command line.
- **Codex project config:** a repo's `.codex/config.toml` is shown even when Codex wouldn't apply it, which happens when the project isn't trusted.
- **Small parsers:** frontmatter and TOML are read by small parsers that handle the common forms only. Unusual files may show blank fields.
- The shaded area in the app always follows the first recorded agent, not the name typed into the catch-up box.
