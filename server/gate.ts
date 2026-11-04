// Claude Code runs this before each shell command of an agent this app started. A push waits for your click in the app.
// shortcut: it reads the command text, so a push from inside a script file isn't caught. A pre-push hook would catch those too.
const PUSH = /\bgit\b[\s\S]*\bpush\b/

let input = ''
for await (const chunk of process.stdin) input += chunk
let command = ''
try {
  command = String(JSON.parse(input.replace(/^﻿/, '')).tool_input?.command ?? '')
} catch {
  // Not a shell command this gate understands, so it has no opinion.
}

if (PUSH.test(command)) {
  const allow = await fetch(`${process.env.OMNI_API}/runs/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ run: process.env.OMNI_RUN, key: process.env.OMNI_ASK_KEY, command }),
    // Ends before Claude Code's 600-second hook timeout, which would otherwise fall back to its own rules.
    signal: AbortSignal.timeout(540_000),
  })
    .then((r) => r.json())
    .then((body) => body.allow === true)
    .catch(() => false)
  const reason = allow ? 'Approved in OmniCodeSpace.' : 'Pushing needs approval in OmniCodeSpace, and it was refused or not answered in time. Leave the work on this branch.'
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: allow ? 'allow' : 'deny', permissionDecisionReason: reason } }))
}

export {}
