# Agent Instructions for `jskit-ai`

## Startup
On startup, read every file in `agents/*` before making changes.
Do not read all of `agent-index/*` on startup.

## Required Inventory Check
Before editing code, identify the package or tooling module you are likely to touch.

Before adding or changing any helper, composable, formatter, validator, route helper, link helper, display helper, or shared utility:
  1) Read `agents/KERNEL_MAP.md`
  2) Read the relevant package map(s) in `agent-index/`
  3) Prefer an existing helper in kernel or the owning package before creating a new one
  4) In the pre-change checkpoint, state exactly which map files you checked

If you are touching `packages/<name>/...`, read:
  * `agent-index/packages/<name>.md`

If you are touching `tooling/<name>/...`, read:
  * `agent-index/tooling/<name>.md`

If you are unsure which package map applies, read:
  * `agent-index/README.md`

## Helper Reuse Rule
Do not create a new helper until you have checked the relevant inventory files.

Search order:
  1) `agents/KERNEL_MAP.md`
  2) relevant `agent-index/packages/<name>.md`
  3) relevant `agent-index/tooling/<name>.md`

If an existing helper is close, extend or reuse it instead of creating a duplicate.
If you still create a new helper, explain why the existing candidates were rejected.

## Minimum Cross-Checks By Area
  * CRUD UI, forms, view, edit, list:
    `agent-index/packages/users-web.md`, `agent-index/packages/crud-core.md`, `agent-index/packages/crud-ui-generator.md`
  * Validation, parsing, errors:
    `agent-index/packages/kernel.md`, `agent-index/packages/http-runtime.md`, `agent-index/packages/crud-core.md`
  * Generators:
    the generator package map plus the runtime package maps it feeds
  * Shell, menu, icon work:
    `agent-index/packages/users-web.md` and `agents/ICONS.md`

## Keep The Index Current
If package structure or exports change in a way that makes the inventory stale, run:
  * `npm run agents:build-index`

## Golden HARD RULE when adding or changing anything: 
  * No tricks. Code needs to be understood by a junior programmer
  * Best practices. Tidy. Minimal
  * NO SLOP. NO REPETITIONS. Do not introduce small general methods without CAREFULLY checking whether that method already 
  * IGNORE completely any code in LEGACY/

## After finishing a set of modificatons
After making a set of modifications, do a last check, and if one of them fails, go back to the code and fix it. The
requirements for passing are:
  1) It has no slop/repeated code
  2) It doesn't repeat the same shit in different files
  3) It doesn't reinvent something that was already in the kernel
  4) It doesn't mitigate the problem in different layeas at the same time
  5) It IS the most elegant solution available, which fits with the system
 
