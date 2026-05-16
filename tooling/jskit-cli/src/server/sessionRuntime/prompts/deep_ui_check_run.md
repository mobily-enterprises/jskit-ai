Deep UI quality check for JSKIT session {{session_id}}.

Phase: {{phase}}
GitHub issue: {{issue_url}}
Issue number: {{issue_number}}
Issue title: {{issue_title}}
Issue body file: {{issue_file}}
Worktree: {{worktree}}

Changed files since the session base:

{{changed_files}}

Run a focused UI quality pass for the current worktree. If this is not UI-impacting after inspection, say exactly why and do not edit files. If the issue touches UI, inspect the changed routes, views, components, placements, layouts, and styles.

Before changing user-facing JSKIT UI, read the relevant JSKIT agent docs when available: `node_modules/@jskit-ai/agent-docs/patterns/ui-testing.md`, `node_modules/@jskit-ai/agent-docs/patterns/page-scaffolding.md`, `node_modules/@jskit-ai/agent-docs/patterns/placements.md`, and `node_modules/@jskit-ai/agent-docs/patterns/surfaces.md`. If working inside the JSKIT monorepo or a devlinked sibling, use the equivalent `packages/agent-docs/...` paths.

Check:

- Material Design quality.
- Vuetify best practices.
- visual hierarchy and density.
- spacing and alignment.
- responsive behavior on mobile, tablet, and desktop.
- loading, empty, error, disabled, and success states where relevant.
- accessibility basics.
- route and navigation coherence.
- consistency with the existing app style.

When clear scoped UI issues exist, fix them in the worktree. Keep fixes limited to the issue.

Use Playwright for a meaningful route check when possible. If login is required, use a development-only auth bootstrap path. When possible, record UI verification with:

`npx --no-install jskit app verify-ui --command "<playwright command>" --feature "<label>" --auth-mode <mode>`

Important: `npx --no-install jskit app verify-ui` does not start the app server. Before running it, make sure the app is reachable by Playwright. If a local server is needed, inspect `.jskit/config/testrun_command` when present and use the app's documented server command, or start the server explicitly and wait for it before invoking `verify-ui`. Do not first run a bare Playwright command against a stopped server.

Do not create commits, branches, issues, pull requests, merges, or worktree cleanup. JSKIT session owns those steps.

When finished, summarize UI findings, fixes, verification, why no UI work applied, and any meaningful UI verification gaps.
