1) Source of truth audit (your exact problem)

Prompt:
“You are auditing this repo for duplicate/parallel sources of truth. Find any place where data is reconstructed, hardcoded, mirrored, cached, or redefined just to serve display/CLI/UI instead of being derived from the authoritative model/store.
Output: a list of findings with (a) file/lines, (b) what the source of truth should be, (c) what shadow copy exists, (d) why it’s risky, (e) suggested refactor to make derivation explicit.”

2) “Fake architecture” detector (abstractions that don’t pull weight)

Prompt:
“Identify abstractions that add complexity without real benefit: wrappers, helper layers, ‘service’ classes, adapter patterns, factories, registries, event buses, plugin systems.
For each: show call graph usage, what complexity it introduces, and whether it could be replaced by something simpler. Flag anything that looks like it exists because the author wanted a pattern, not because the system needed it.”

3) Contract drift: types/interfaces vs reality

Prompt:
“Check for contract drift: places where TypeScript types / JSDoc / schemas / interfaces claim one thing but runtime code behaves differently.
Find mismatches like optional fields that are required, string/number confusion, nullable fields used unsafely, or ‘any’/type casts hiding uncertainty.
Produce a prioritized list with concrete examples and fixes.”

4) “Convenient lies” in errors, logging, and UX

Prompt:
“Audit error handling and logs for misleading or invented messages (e.g., error says one thing but catch block swallows real cause, or logs claim success when partial failure happened).
Find catch blocks that discard error context, generic ‘failed’ messages, retries without surfacing, and places returning success codes despite failure.
Output: exact locations + better error strategy.”

5) Hidden global state / spooky action at a distance

Prompt:
“Search for implicit shared state: singletons, module-level mutable variables, hidden caches, global registries, monkey patches, environment-dependent behavior.
For each finding, explain how it can cause non-local bugs, test flakiness, or order-dependence. Suggest how to inject dependencies or make state explicit.”

6) Dead code / unused complexity / “never actually called”

Prompt:
“Find dead or near-dead code: functions/classes not referenced, feature flags that are always on/off, branches that never execute, duplicated utilities, half-built subsystems.
Use repo-wide reference search + reasoning about runtime entrypoints.
Output: what can be deleted vs what needs integration/tests.”

7) Performance footguns (esp. accidental N² and sync I/O)

Prompt:
“Look for performance hazards: nested loops over large collections, repeated parsing/serialization, synchronous fs calls in hot paths, excessive cloning, repeated regex compilation, unbounded concurrency, per-request expensive initialization.
Rank findings by likely impact and show minimal refactors.”

8) Async correctness: races, missing awaits, double-resolves

Prompt:
“Audit async code for correctness issues: missing await, promise chains not returned, forEach(async…), race conditions, timeouts without cancellation, event listeners not removed, concurrent mutation of shared structures.
Provide examples, explain the bug class, and propose safe patterns.”

9) Security & trust boundaries (where data becomes “trusted” too early)

Prompt:
“Map all inputs (CLI args, env vars, HTTP requests, file reads, IPC, plugin loading). Identify trust boundary violations: unsanitized interpolation into shell commands, path traversal, unsafe YAML/JSON parsing, eval/new Function, dynamic require/import from user input, weak auth checks, missing permission checks.
Output a threat list + concrete fixes.”

10) Invariant checks: where the code assumes things but never asserts them

Prompt:
“Find places where the system relies on unstated invariants (e.g., ‘this map always has the key’, ‘dependency graph is acyclic’, ‘IDs are unique’, ‘config always loaded before use’) but never checks/guards them.
Recommend where to add assertions, validation, and tests. Provide specific invariant statements.”

---
