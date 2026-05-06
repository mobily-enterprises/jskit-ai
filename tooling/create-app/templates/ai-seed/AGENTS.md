# AI Seed Instructions

This workspace is intentionally only a JSKIT seed scaffold. It is not a real JSKIT app yet.

Use this file only for the initial JSKIT setup conversation.

If you need more JSKIT documentation before the real scaffold exists, use:

- `https://github.com/mobily-enterprises/jskit-ai/blob/main/packages/agent-docs/site/guide/index.md`
- `https://github.com/mobily-enterprises/jskit-ai/blob/main/packages/agent-docs/site/guide/app-setup/initial-scaffolding.md`
- `https://github.com/mobily-enterprises/jskit-ai/blob/main/packages/agent-docs/site/guide/app-setup/quickstart.md`
- `https://github.com/mobily-enterprises/jskit-ai/blob/main/packages/agent-docs/site/guide/app-setup/working-with-the-jskit-cli.md`

What to do now:

1. Ask only the Stage 1 setup questions first:
   - app purpose
   - tenancy mode: `none`, `personal`, or `workspaces`
   - database engine: MySQL or Postgres
   - auth provider
   - whether the baseline should include users, console, workspaces, realtime, or assistant
2. If a database-backed baseline is selected, do not stop at the engine name. Confirm one of these is true before moving on:
   - the target database already exists and the app connection values are known
   - or the developer has enough local admin or create-database access for the chosen engine to create it now
3. Once the baseline package stack is clear, ask plainly for the exact local development setup values needed for the next chosen install step. Use the real env var names or option names instead of vague requests for "credentials".
4. Treat those values as routine local development setup inputs, not production secrets. Examples:
   - `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
   - `AUTH_SUPABASE_URL`, `AUTH_SUPABASE_PUBLISHABLE_KEY`, `APP_PUBLIC_URL`
   - `OPENAI_API_KEY` if assistant support is selected
5. For MySQL or Postgres, if the database does not exist yet, ask for whatever local admin or create-database access is needed to create it, then make sure the database exists before promoting the scaffold. Do not move on while the database is still hypothetical.
6. If assistant support is selected, explain that `OPENAI_API_KEY` can be given now or wired later; the scaffold can still be created first.
7. Do not hand-write JSKIT runtime files or invent file topology in this seed workspace.
8. Once the Stage 1 decisions are clear, promote this directory into the real app scaffold by running:
   `npx @jskit-ai/create-app <app-name> --target . --force --tenancy-mode <mode>`
   Use the current directory name as `<app-name>` unless the developer explicitly wants a different app name.
9. After that, run `npm install`.
10. Then stop, re-read the overwritten `AGENTS.md`, and continue with the normal JSKIT app workflow from that file. Do not rely on memory from the seed stage.
11. Do not install JSKIT runtime packages until the new app `AGENTS.md` has been re-read.
