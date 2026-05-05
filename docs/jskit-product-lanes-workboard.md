# JSKIT Product Lanes Workboard

Status: draft

Purpose:

- turn the broader product-lanes direction into an execution plan
- keep priorities explicit
- avoid treating every possible improvement as equal-priority implementation work

This is a prioritized workboard, not a manifesto.

## Scope

The work is to align the repo to the intended JSKIT product shape:

- strong default lane
- explicit weird/custom lane
- strong command lane

The work is not:

- a full architecture rewrite
- a plan to remove lower-level escape hatches
- a plan to command-ize every possible mutation

## Priority Order

1. strengthen the existing golden path
2. remove duplicate seams
3. add `doctor` enforcement for known anti-patterns
4. add a small number of new high-level commands only if the gap is clearly real
5. polish docs and catalog output around the resulting shape

## Phase 1: Ownership Cleanup

Goal:

- stop shipping obvious baseline runtime/orchestration behavior as large app-owned copied files

Tasks:

- audit package descriptors and templates for large app-owned files that contain generic runtime or host orchestration
- classify each suspect file as:
  - legitimate customization seam
  - suspicious copied runtime host
  - transitional file that should move back into package ownership
- move generic host/orchestration logic back into package ownership
- keep only intentionally customizable leaves, wrappers, or branded layout files app-owned
- document the smell rule for copied orchestration files

High-value examples already known:

- `users-web` account settings host
- `workspaces-web` pending invites cue

Done when:

- the strongest known ownership bugs are removed
- package-owned hosts / app-owned leaves is the dominant shape for baseline package UI

## Phase 2: Strengthen The Existing Golden Path

Goal:

- make the current package + generator flow structurally correct without requiring lower-level knowledge

Tasks:

- audit `ui-generator`, `crud-server-generator`, and `crud-ui-generator` against the intended happy path
- ensure generated code derives from shared contracts instead of duplicating them
- keep shared `*Resource.js` canonical for CRUD
- keep transport derivation automatic from the shared resource
- remove duplicated seams in generated output where the framework already knows the answer
- improve deterministic and readable generator output where necessary
- define and add `feature-server-generator scaffold` as the standard non-CRUD server lane for substantial server-side features
- make package-with-provider the default generated shape for those features

Focus areas already known:

- CRUD UI transport derivation
- CRUD repository JSON REST scope correctness
- shared lookup / relationship handling
- `feature-server-generator` package scaffolding
- provider/service/repository boundary enforcement

Done when:

- the standard generator output is structurally aligned with the intended lane
- normal follow-up app edits happen in obvious app-owned places
- substantial non-CRUD server features no longer require ad hoc topology decisions

## Phase 3: Command Lane Clarity

Goal:

- make the command lane tell the standard JSKIT story clearly

Tasks:

- review `jskit help`, `jskit list`, and `jskit show --details`
- improve how they explain:
  - what is package-owned
  - what becomes app-owned
  - what a package contributes
  - where the normal lane differs from lower-level tools
- make it clear that substantial server features should start from a generator command and land in their own packages
- make standard command sequences easier to discover
- improve update/remove/help text where it helps explain the default lane

Done when:

- a user can discover the standard lane from the CLI itself more easily

## Phase 4: Doctor Enforcement

Goal:

- detect known lane violations instead of passively tolerating drift

Candidate checks:

- raw `fetch(...)` in normal app/client code where a JSKIT request seam should be used
- large copied app-owned files that still match package-owned baseline hosts
- manual transport literals on high-level CRUD hooks
- stale or obviously invalid resource shapes
- extension seams that bypass placements in normal situations
- stale package-managed files that could be safely re-adopted
- service-layer code that reaches directly into persistence in the default lane
- substantial domain feature logic added under `packages/main`
- generated persistent feature packages missing a repository seam
- default-lane repositories bypassing the standard internal `json-rest-api` path without an explicit exception

Done when:

- `jskit doctor` can catch the highest-value known anti-patterns

## Phase 5: Narrow New High-Level Commands

Goal:

- add only the most justified command-lane improvements

Guardrail:

- do not add new high-level commands unless the golden path is still missing a real, repeatable, high-friction normal workflow

Most likely candidates:

- a `ui-generator section` command for the common "top-level section page + placement + child-page host" pattern
- possibly a higher-level CRUD orchestration command if the existing server-first/UI-second flow still feels too fragmented for common use
- `feature-server-generator scaffold` for engines, workflows, and other substantial server-side features that should live in dedicated packages

Lower priority:

- command-izing every post-scaffold mutation
- expanding the CLI before the existing lane is clean

Done when:

- a small number of proven gaps are filled without creating a new layer of command sprawl

## Phase 6: Documentation And Catalog Alignment

Goal:

- make docs and metadata describe the lane the repo actually enforces

Tasks:

- add one central "normal lane vs custom lane" guide chapter
- make the command lane more visible across the guide
- document the ownership rules clearly
- document when to stay on the happy path and when to drop to lower-level seams
- extend package metadata and catalog output where useful so ownership and extension seams are clearer

Done when:

- the docs and CLI/catalog story match the actual framework behavior

## First Implementation Tranche

The recommended first implementation tranche is:

1. finish the strongest ownership cleanup
2. strengthen the existing generator/golden path, including the non-CRUD server lane
3. add targeted `doctor` enforcement for the most obvious violations

Do not start with:

- lots of new commands
- a giant docs rewrite
- broad speculative metadata work

## Review Questions For Every Chunk

- does this make the default lane stronger?
- does this remove a duplicate or misleading seam?
- does this keep the weird lane available without normalizing it?
- does this make command-backed normal work clearer?
- does this create a better ownership boundary?

## Current Open Questions

- which remaining package-owned hosts are still incorrectly copied into app ownership?
- which command-lane gaps are real enough to justify new high-level commands?
- which `doctor` checks are precise enough to add without producing noisy false positives?
- which metadata changes help the CLI tell the ownership story best without overcomplicating the package catalog?
- what is the narrowest first-party non-CRUD server generator shape that solves the booking-engine class of problem without opening a second muddy middle?
