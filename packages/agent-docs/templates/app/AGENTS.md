# App Agent Instructions

JSKIT issue work is driven by the executable session workflow.

Use:

- `jskit session` to list existing sessions.
- `jskit session create` to start a new issue session.
- `jskit session <session_id>` to inspect durable session state.
- `jskit session <session_id> step` to run the next workflow step or get the next prompt.
- `jskit session <session_id> step --json` when a tool or UI needs machine-readable state.

Do not invent a parallel manual issue workflow. Follow the current session step output.

If dependencies are missing, install them first. If `npm install` is run while this app uses local JSKIT checkout links, run `npm run devlinks` immediately afterward.

For JSKIT implementation details, use package docs, generated references, and `node_modules/@jskit-ai/agent-docs/patterns/INDEX.md` only as technical references. They are not the issue workflow source of truth.
