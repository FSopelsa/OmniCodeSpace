## Reviewer report is missing from the app's diff

- **Severity:** medium
- **Where:** `templates/reviewer.md:12`
- **What goes wrong:** For a project without a tracked `review.md`, the reviewer creates an untracked file. The run review uses `git diff`, which excludes untracked files, so the app lists the filename but does not show its findings.
- **Suggested fix:** Include the contents of untracked review reports in the run review.

## A template's model remains after changing tools

- **Severity:** medium
- **Where:** `src/Runs.tsx:27`
- **What goes wrong:** Select Docs writer, then change the tool to Codex or select a template without a tool or model. The model remains `sonnet`, so the run can start with a model the selected tool does not support and fail.
- **Suggested fix:** Clear or replace template-supplied model values when the tool or template changes.

## One unreadable template hides every template

- **Severity:** medium
- **Where:** `server/templates.ts:17`
- **What goes wrong:** If one project template is unreadable, deleted during loading, or is a directory named with a `.md` suffix, its read rejects the whole list. The dialog silently shows no templates, and requests for other templates fail too.
- **Suggested fix:** Handle individual file read failures and show a useful error without hiding readable templates.

Tests: `npm test` passed 92 tests. `npm run check` could not run because installed Node and Vite type definitions are missing.

Verdict: merge after fixes.
