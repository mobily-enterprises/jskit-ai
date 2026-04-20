# Feature Delivery Workflow

Before implementation, break the planned work into chunks.

Chunk rules:

- One CRUD is usually one chunk.
- Platform setup, shell/navigation, and cross-cutting integrations may be separate chunks.
- A chunk must be independently reviewable and testable.
- If a chunk is too broad to review confidently, split it before coding.

For each chunk, follow this order:

1. Scope the chunk inside the blueprint.
2. Mark the chunk as active in `.jskit/WORKBOARD.md`.
3. Decide whether it is:
   - package install
   - generator scaffolding
   - custom local code
   - or a combination
4. Implement the smallest correct change.
5. Deslop the chunk.
6. Review the chunk against JSKIT reuse and best practices.
7. Review user-facing screens against Material Design and Vuetify best practices, and improve any screens that do not meet that bar.
8. Verify the chunk with the relevant commands. Any chunk that adds or changes user-facing UI must include a Playwright flow that exercises the changed behavior, and that run must be recorded with `jskit app verify-ui`.
9. Update `.jskit/WORKBOARD.md` with status, commands run, and anything still unverified.
10. Only then move to the next chunk.

For CRUD chunks:

1. Decide the table shape first.
2. If `crud-server-generator` is going to own the CRUD schema, do not hand-write a separate migration for that CRUD table.
3. Scaffold the server side first with `crud-server-generator`.
4. Only after the shared resource file exists, scaffold the client side against that resource.
5. Do not guess CRUD operations or screen shape. Ask the developer:
   - which operations are allowed
   - which fields belong in the list view if one exists
   - what the view form should look like
   - what the edit/new form should look like

During implementation:

- Prefer existing JSKIT helpers over local helper duplication.
- If a selected JSKIT package already ships the required baseline workflow, install and verify that workflow before inventing custom code around it.
- Ask only about overrides, restrictions, or app-specific additions to packaged baseline workflows.
- Use generated CRUD/UI scaffolds only after the route and ownership model are decided.
- Keep runtime, UI, and data concerns separated.
- Avoid “while I’m here” scope creep unless it is required for correctness.

After the last chunk:

- If there was only one chunk, the chunk review is the final review.
- If there was more than one chunk, run one more whole-changeset pass:
  - deslop the whole changeset
  - review the whole changeset against JSKIT best practices
  - review the whole changeset against Material Design and Vuetify best practices
  - run the widest relevant verification, including Playwright
  - update `.jskit/WORKBOARD.md` with the final result and any remaining gaps

Playwright note:

- When login is required, use a test-only auth bypass or session bootstrap path instead of dependence on a live external auth provider.
- Record the run through `jskit app verify-ui --command "<playwright command>" --feature "<label>" --auth-mode <mode>` so `jskit doctor` can verify the receipt against the current changed UI files.
- In the standard JSKIT auth stack, the default development path is `POST /api/dev-auth/login-as`, guarded by `AUTH_DEV_BYPASS_ENABLED=true` and `AUTH_DEV_BYPASS_SECRET=...`.
- That route is development-only and must not be enabled in production.
- Because it is still an unsafe POST, fetch `csrfToken` from `/api/session`, send it as the `csrf-token` header, and make the request in the same browser context that will run the Playwright assertions so the session cookies land in the page session.
- If such a path does not exist yet, treat that as a testability gap and decide whether the chunk must add it before the feature is considered complete.
