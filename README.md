# OmniCodeSpace

A local workspace for coding agents and the people running them, with git as the shared memory. It shows your projects as track diagrams, shows which Claude Code and Codex sessions have worked on them, and tells a returning agent what changed since it last looked.

![OmniCodeSpace showing a project's branches as tracks](docs/prototypes/scaffold-demo.png)

**Status: early.** The app only reads for now. Starting agents and passing work between them are planned in [docs/PLAN.md](docs/PLAN.md), and the [prototypes](docs/prototypes) show where it's heading.

## What it does today

- Finds the git repos in your projects folder and draws each one's recent branches and commits.
- Lists the Claude Code and Codex sessions that ran in each project, with model, branch and token use, read from the logs those tools already keep.
- Lists the agents defined for each project, from Claude Code, Codex and enabled plugins, with their instructions, tools and the runs that used them.
- Shows what agents can touch in each project: permission rules, sandbox and approval settings, MCP servers, skills and plugins.
- Shows which instruction files a project gives its agents.
- Writes a catch-up brief for a returning agent: commits, changed files, uncommitted work and unmerged branches since its last visit.
- Delivers that brief automatically when a Claude Code or Codex session starts, and asks agents to sign their commits with who and why.

## Requirements

Node.js 24 or newer and git, on Windows, macOS or Linux. Development and testing have only been done on Windows 11.

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

## Data and privacy

- Everything stays on your computer. There are no accounts, no telemetry and no cloud service.
- The server listens on `127.0.0.1` and refuses requests from other hosts and from other websites.
- Session logs can contain anything you or an agent typed, including secrets. The app shows their metadata (title, model, branch, folder, tokens), never the conversation.
- To show what agents can touch, the app reads Claude Code's and Codex's settings files. MCP servers appear by name only. Their commands, arguments and environment values, where keys often live, never reach the browser.
- The web app changes nothing. Only the command line writes: `enable` makes the changes listed above, and `seen`, `arrive` and `hook` move refs under `refs/omni/`.
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
- `server/api.ts`: the local read-only API.
- `server/cli.ts`: the command line.
- `server/enable.ts`: turns on automatic catch-up for a repo.
- `src/`: the React interface. `lanes.ts` places commits on tracks.
- `docs/PLAN.md`: research, decisions and next steps.
