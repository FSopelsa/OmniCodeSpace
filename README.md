# OmniCodeSpace

A local workspace for coding agents and the people running them, with git as the shared memory. It shows your projects as track diagrams, shows which Claude Code and Codex sessions have worked on them, tells a returning agent what changed since it last looked, and starts agents in their own branches with your approval before they push.

![OmniCodeSpace showing a project's branches as tracks](docs/prototypes/scaffold-demo.png)

**Status: early.** Passing work between agents, local models and other machines are planned in [docs/PLAN.md](docs/PLAN.md), and the [prototypes](docs/prototypes) show where it's heading.

## What it does today

- Finds the git repos in your projects folder and draws each one's recent branches and commits.
- Lists the Claude Code and Codex sessions that ran in each project, with model, branch and token use, read from the logs those tools already keep.
- Lists the agents defined for each project, from Claude Code, Codex and enabled plugins, with their instructions, tools and the runs that used them.
- Shows what agents can touch in each project: permission rules, sandbox and approval settings, MCP servers, skills and plugins.
- Shows which instruction files a project gives its agents.
- Writes a catch-up brief for a returning agent: commits, changed files, uncommitted work and unmerged branches since its last visit.
- Delivers that brief automatically when a Claude Code or Codex session starts, and asks agents to sign their commits with who and why.
- **Roster:** today's work on this PC as a timetable, one row per agent and project, with scheduled Codex automations and their next run.
- **Map:** one project as the hub of everything that works on it: worktrees, Claude Code, Codex and their agents, remotes. Select a node for its models, plugins, MCP servers, skills, instruction files and tech stack.
- **Start an agent:** runs Claude Code or Codex on a task in a new branch and folder, streams its output, can stop it, waits for your click before Claude Code pushes, and shows the branch for review.

## Requirements

Node.js 24 or newer and git, on Windows, macOS or Linux. To start agents, Claude Code or Codex must be installed and signed in. Development and testing have only been done on Windows 11.

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Then open http://127.0.0.1:5173. It looks in `~/IdeaProjects` by default. To use other folders, set `OMNI_ROOTS` to a list separated by `;` on Windows or `:` elsewhere.

## Catching up agents automatically

Run this once in each repo where you want it, with the path adjusted to your copy:

```bash
node path/to/OmniCodeSpace/server/cli.ts enable --repo path/to/your/repo
```

From then on, a new or resumed Claude Code or Codex session in that repo is told what changed since that tool last looked. If nothing changed, it's told nothing, so a quiet repo costs no tokens.

`enable` makes these changes, and commits nothing:

- **`.claude/settings.local.json`** gets a session-start hook. Existing settings are kept, and the file is excluded from git through `.git/info/exclude`.
- **`AGENTS.md`** gets a short section with two rules. Codex should run the catch-up at the start of a session, and every agent should end its commit messages with `Agent:` and `Why:` trailers. For anyone without this tool the catch-up command just fails, and the note says to carry on.
- **`CLAUDE.md`** points Claude Code at those rules. If the repo has no `CLAUDE.md`, one is created holding just `@AGENTS.md`. If it has one, the trailer rule is added to it.
- **The repo's own git config** gets an alias, `git omni`. It's the only place that holds the path to this tool, so tracked files stay free of machine-specific paths.

Review `AGENTS.md` and `CLAUDE.md`, and commit them if you want to keep the rules.

To turn it off, remove the hook and the notes, then run:

```bash
git config --local --unset alias.omni
```

### How it decides what's new

- Each tool has a last-seen pointer, stored as a git ref at `refs/omni/seen/<name>`. A normal `git push` doesn't send refs there.
- A resumed Claude Code chat also has its own pointer under `refs/omni/chats/`, so it hears about changes that another chat already moved past. Each chat leaves one small ref behind.
- When Claude Code reports that a resumed chat's prompt cache has likely expired, the hook also shows you a message suggesting a new chat. Your next message in the old chat would pay to cache its whole history again, and a new chat only needs the brief.
- A brief is capped at 9,500 characters, and it tells the agent to treat commit messages as information, not instructions.

### By hand

```bash
node path/to/OmniCodeSpace/server/cli.ts catchup --agent my-agent
```

```bash
node path/to/OmniCodeSpace/server/cli.ts seen --agent my-agent
```

`catchup` prints the brief and estimates its size against reading every tracked text file. `seen` records that the agent is up to date.

The trailers that `enable` asks for appear in the brief and in the app. You can also add them to your own commits:

```text
Agent: Local builder
Why: Sessions expired mid-checkout
```

## Starting an agent

Select **Start an agent**, pick a project and a tool, and describe the task. The dialog says what will happen before anything runs.

- **Its own branch and folder.** The agent works on a new branch, `omni/<task words>-<id>`, in a new folder beside the project: `<project>.worktrees/`. Your own checkout isn't touched.
- **Claude Code** runs as `claude -p`. It may edit files and commit in that folder without asking. Other commands follow your own Claude Code permission rules, and the run lists any they refused.
- **Pushing waits for you.** When Claude Code tries to push, the run turns amber and shows the command, with **Allow push** and **Refuse**. No answer within 9 minutes counts as Refuse.
- **Codex** runs as `codex exec` in its `workspace-write` sandbox, with the network off, so it can't push. The sandbox also keeps `.git` read-only, so its changes stay uncommitted for you to review and commit. Codex itself also marks the project as trusted in `~/.codex/config.toml` the first time.
- **Live output and stop.** The Roster tab lists runs started from here. Select one for its output, a stop button, and, once it ends, its commits and diff.
- **Cleaning up.** Merge or push the branch yourself when you're happy, then remove the folder with `git worktree remove <folder>`.

The app finds `claude` on your PATH, and Codex inside the Codex desktop app's folder or on your PATH. Set `OMNI_CLAUDE` or `OMNI_CODEX` to use other copies. Runs use your own login for each tool. Anthropic's terms don't clearly say whether scripting Claude Code with a subscription is allowed, so read them yourself, and see the hurdles in [docs/PLAN.md](docs/PLAN.md).

The push check is a guardrail against mistakes, not a sandbox. It reads the command an agent runs, so a push from inside a script isn't caught.

## Data and privacy

- Everything stays on your computer. There are no accounts, no telemetry and no cloud service.
- The server listens on `127.0.0.1` and refuses requests from other hosts and from other websites. Anything that writes needs a token that is made each time the server starts and is put into the page.
- Session logs can contain anything you or an agent typed, including secrets. The app shows their metadata (title, model, branch, folder, tokens), never the conversation.
- To show what agents can touch, the app reads Claude Code's and Codex's settings files. MCP servers appear by name only. Their commands, arguments and environment values, where keys often live, never reach the browser.
- The web app writes only when you start an agent: it adds a branch and a worktree folder, and runs the tool there. The command line writes too: `enable` makes the changes listed above, and `seen`, `arrive` and `hook` move refs under `refs/omni/`.
- Remote URLs are shown without any login they contain.
- Briefs go into the agent's conversation, so whichever model provider that tool uses receives them, as it does everything else in the session.

## Checks

```bash
npm test
```

```bash
npm run check
```

## Layout

- `server/git.ts`: every git query, and the catch-up brief.
- `server/sessions.ts`: reads Claude Code and Codex session logs, including subagent runs.
- `server/setup.ts`: reads agent definitions and what agents can touch.
- `server/schedules.ts`: reads scheduled Codex automations.
- `server/stack.ts`: what a project is built with, and its remotes.
- `server/runs.ts`: starts, streams, stops and reviews agent runs. `server/gate.ts` is the hook that holds a push for your approval.
- `server/api.ts`: the local API.
- `server/cli.ts`: the command line.
- `server/enable.ts`: turns on automatic catch-up for a repo.
- `src/`: the React interface, with the Tracks, Roster and Map views. `lanes.ts` places commits on tracks, `roster.ts` lays out the day.
- `docs/PLAN.md`: research, decisions and next steps.
