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
7. Verify the chunk with the relevant commands, including Playwright for meaningful UI flows.
8. Update `.jskit/WORKBOARD.md` with status, commands run, and anything still unverified.
9. Only then move to the next chunk.

During implementation:

- Prefer existing JSKIT helpers over local helper duplication.
- Use generated CRUD/UI scaffolds only after the route and ownership model are decided.
- Keep runtime, UI, and data concerns separated.
- Avoid “while I’m here” scope creep unless it is required for correctness.

After the last chunk:

- If there was only one chunk, the chunk review is the final review.
- If there was more than one chunk, run one more whole-changeset pass:
  - deslop the whole changeset
  - review the whole changeset against JSKIT best practices
  - run the widest relevant verification, including Playwright
  - update `.jskit/WORKBOARD.md` with the final result and any remaining gaps

Playwright note:

- When login is required, prefer a test-only impersonation or session bootstrap path over dependence on a live external auth provider.
- If such a path does not exist yet, treat that as a testability gap and decide whether the chunk must add it before the feature is considered complete.
