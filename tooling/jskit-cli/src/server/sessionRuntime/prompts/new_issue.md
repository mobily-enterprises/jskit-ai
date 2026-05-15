Create a GitHub issue from this user request:

{{user_input}}

First inspect the local app enough to understand the request in context. App setup has already passed before this prompt is rendered; treat this as a ready JSKIT app. This issue-drafting step is read-only.

Allowed inspection:

- Read files with commands such as `pwd`, `ls`, `find`, `rg`, `cat`, `sed`, and `git status`.
- Read package.json, `.jskit/lock.json`, config, routes, packages, source files, `.jskit/APP_BLUEPRINT.md`, and `.jskit/helper-map.md` when available.
- Use non-mutating JSKIT inspection commands when available and relevant: `npx --no-install jskit list`, `npx --no-install jskit show <package> --details`, and `npx --no-install jskit list-placements`.
- Read JSKIT agent docs before inferring framework patterns from source. Start with `node_modules/@jskit-ai/agent-docs/DISTR_AGENT.md`, `node_modules/@jskit-ai/agent-docs/guide/agent/index.md`, and `node_modules/@jskit-ai/agent-docs/patterns/INDEX.md` when present. If working inside the JSKIT monorepo or a devlinked sibling, use `packages/agent-docs/...` as the source-tree equivalent. Then read only the relevant pattern docs for the request, such as CRUD, page scaffolding, surfaces, placements, client requests, live actions, or UI testing.
- If the filesystem contradicts a ready JSKIT app, stop and report that app setup must be rerun. Do not draft a recovery issue inside this session.

Do not run workflow, repair, or mutation commands during issue drafting:

- Do not run `npx --no-install jskit session`, `npx --no-install jskit session step`, or any command that advances a JSKIT session.
- Do not run `gh`, `git add`, `git commit`, `git push`, `npm install`, generators, tests, verification, devlinks, or doctor commands.
- Do not try to fix missing PATH entries or missing helper binaries. If a tool is unavailable, continue with read-only file inspection.
- Do not edit files.

Draft an implementation-ready issue, not a broad product essay.

Preserve these JSKIT boundaries:

- If platform choices are still provisional, make the issue resolve those choices before installing tenancy-sensitive packages.
- Do not ask the developer to redesign standard JSKIT package-owned workflows from scratch. Treat selected package workflows as defaults unless the request asks for overrides, restrictions, or custom additions.
- For persisted app-owned data, prefer generated/package ownership over direct hand-built persistence. A new ordinary table should usually become a server CRUD-owned entity before CRUD UI or route work.
- For non-CRUD app pages, prefer the JSKIT UI generator when it fits.
- Keep direct knex or low-level runtime work exceptional and explicitly justified.
- Prefer documented JSKIT guide and pattern docs over reverse-engineering framework architecture from source files. Use source inspection to understand this app and verify details, not as the first source of JSKIT design rules.
- Do not include workflow bookkeeping such as old workboards in the issue body. JSKIT session state and receipts are the workflow tracker.

Ask concise clarifying questions if the request is not specific enough to produce a useful implementation issue. Ask only for details that materially change the ticket.

When the issue is ready, output only the final issue title and body surrounded by these exact markers:

[issue_title]
<short issue title>
[/issue_title]

[issue_text]
<issue body in Markdown, without repeating the title as a heading>
[/issue_text]

The issue should be concrete, scoped, and implementation-ready. Include acceptance criteria when they are useful.
