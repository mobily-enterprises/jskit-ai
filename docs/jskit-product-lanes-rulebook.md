# JSKIT Product Lanes Rulebook

Status: draft

Purpose:

- define the intended JSKIT product shape clearly enough that framework, generators, package descriptors, CLI output, and docs can be aligned to it
- keep the standard authoring path strong without removing lower-level escape hatches

This is a product rulebook, not an implementation backlog.

## Core Model

JSKIT should have three clearly separated lanes:

1. `default lane`
2. `weird/custom lane`
3. `command lane`

The product should not have a muddy middle where users accidentally fall into lower-level seams just to accomplish normal work.

## Default Lane

The default lane is the normal JSKIT experience.

It should feel like:

- install runtime capability with `jskit add package ...` or `jskit add bundle ...`
- generate app-owned topology with `jskit generate ...`
- get sensible, readable, deterministic output
- edit the generated files only where app ownership is intentional
- extend pages and surfaces through placements
- rely on shared contracts such as shared CRUD resources, standard client request seams, and the generated JSON:API CRUD path

The default lane should be the easiest lane.

## Weird / Custom Lane

The weird lane is real and supported, but explicit.

Examples:

- local custom packages
- non-standard page structures
- lower-level request seams
- custom endpoint resources
- custom `searchSchema` / `applyFilter(...)` behavior
- intentionally app-owned deviations from the generated baseline

The weird lane must stay available.
It must not become the hidden path that normal users accidentally depend on.

## Command Lane

If something is part of the normal JSKIT experience, there should be a command-backed path for it.

That does not mean every imaginable customization needs a dedicated command.
It means the normal lane must be clearly reachable through commands.

The command lane should:

- help users discover what exists
- explain what is package-owned versus app-owned
- expose the standard install and generate flows clearly
- reinforce the intended architecture through `help`, `list`, `show`, `update`, and `doctor`

## Ownership Rules

JSKIT should consistently enforce three ownership classes:

1. `package-owned runtime`
2. `generator-owned app topology`
3. `app-owned custom code`

### Package-owned runtime

Package-owned runtime includes:

- generic framework orchestration
- runtime services
- generic host components
- package baseline workflows
- shared request / transport / placement / runtime policy

This code should live in the package, not in copied app-owned files.

### Generator-owned app topology

Generators should create app-owned files for:

- route pages
- resource packages
- placements
- shell topology
- CRUD pages
- child-page hosts

These files are app-owned, but they should still start from a strong standard baseline.

### App-owned custom code

App-owned custom code should be where the app genuinely customizes:

- leaf UI
- branding
- page-specific additions
- app-specific business behavior that goes beyond package baseline behavior

## Ownership Smell Rule

If a scaffolded app-owned file contains any of the following, it is probably the wrong seam unless customization is explicitly intended:

- route orchestration
- shared transport wiring
- shared placement merging
- generic runtime state orchestration
- framework policy
- baseline package behavior

In those cases, move the host/orchestration logic back into package ownership and keep only the intended leaf seam app-owned.

## Placements Are The Standard Extension System

Placements should remain the normal extension mechanism for:

- shell links
- subpage tabs
- top-level menu entries
- account/settings sections
- surface widgets
- tool cues

Do not introduce hidden registries or provider-owned section systems for normal page/surface extension when placements are the intended seam.

## Shared CRUD Resource Is Canonical

For the generated CRUD path:

- the shared `*Resource.js` file is the canonical contract
- generated server and client code should derive from it as much as possible
- transport metadata, lookup mapping, and CRUD semantics should not be duplicated manually when the resource already knows them

## Standard CRUD Server Lane

The standard CRUD server lane is:

- generated repository over the internal JSON REST path
- `resource.searchSchema` as the canonical server search/filter contract
- explicit route validators for public query keys
- repository-injected internal filters for private server-only concerns

Custom server behavior is allowed, but the default path should remain obvious and generator-backed.

## Standard CRUD Client Lane

The standard CRUD client lane is:

- `useCrudList`
- `useCrudView`
- `useCrudAddEdit`

These should derive transport and lookup behavior from the shared resource automatically.

Do not require normal CRUD pages to embed or hand-maintain explicit transport objects.

Lower-level seams such as `useList`, `useView`, `useAddEdit`, `useEndpointResource`, and `usersWebHttpClient.request(...)` remain valid escape hatches when the CRUD wrappers no longer fit.

## Fail Clearly, Not Permissively

The standard lane should fail clearly and early when a caller is off the supported path.

Good failures:

- unsupported resource shape
- missing standard relationship data
- invalid route contract
- unsupported explicit transport override on a high-level CRUD seam

Bad behavior:

- permissive half-working fallbacks
- silent drift
- duplicated hidden seams

Advanced users should still have lower-level escape hatches.
But the default lane should not quietly degrade into a permissive mess.

## Product Bias

When choosing what to improve next, bias toward:

1. strengthening the existing golden path
2. removing duplicate seams
3. adding enforcement and diagnostics
4. adding only a small number of new high-level commands where the gap is proven

Do not rush into command-izing every post-scaffold mutation.
First make the existing lane stronger and more coherent.

## What This Rulebook Rejects

- giant app-owned copied runtime hosts as the normal package story
- hidden alternate page/surface extension systems
- duplicated CRUD transport or lookup semantics outside the shared resource
- normal app work relying on raw `fetch(...)`
- making the default lane depend on expert knowledge of lower-level seams

## Success Criteria

JSKIT is closer to the intended product shape when:

- the normal authoring flow is command-backed and obvious
- app-owned files are mostly true customization seams
- package baseline behavior stays package-owned
- placements are the standard extension seam
- shared CRUD resources remain canonical
- weird/custom work is still possible without contaminating the normal lane
