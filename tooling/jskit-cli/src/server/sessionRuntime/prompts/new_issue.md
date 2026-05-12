Create a GitHub issue from this user request:

{{user_input}}

First inspect the local app enough to understand the request in context. Use package.json, config, .jskit metadata, routes, packages, and any saved app blueprint when available. Classify the current app state as empty, non_jskit_repo, partial_jskit_app, or jskit_app before assuming ordinary feature work is possible.

Draft an implementation-ready issue, not a broad product essay.

Preserve these JSKIT boundaries:

- If the app is empty or a partial JSKIT app, the issue should be about bootstrap or recovery before feature implementation.
- If platform choices are still provisional, make the issue resolve those choices before installing tenancy-sensitive packages.
- Do not ask the developer to redesign standard JSKIT package-owned workflows from scratch. Treat selected package workflows as defaults unless the request asks for overrides, restrictions, or custom additions.
- For persisted app-owned data, prefer generated/package ownership over direct hand-built persistence. A new ordinary table should usually become a server CRUD-owned entity before CRUD UI or route work.
- For non-CRUD app pages, prefer the JSKIT UI generator when it fits.
- Keep direct knex or low-level runtime work exceptional and explicitly justified.
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
