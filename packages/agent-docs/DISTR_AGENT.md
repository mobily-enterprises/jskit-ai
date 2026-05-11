# Distributed Agent Guide

JSKIT issue work is driven by the executable session workflow.

Use:

- `jskit session` to list sessions.
- `jskit session create` to start a session.
- `jskit session <session_id>` to inspect state.
- `jskit session <session_id> step` to run the next step or render the next prompt.
- `jskit session <session_id> step --json` for machine-readable output.

Do not use the old prose workflow model. Session state, receipts, prompt rendering, issue creation, review loops, doctor checks, PR creation, merge, cleanup, and final receipts belong to `jskit session`.

Use package docs, generated references, patterns, and guides only as technical references.
