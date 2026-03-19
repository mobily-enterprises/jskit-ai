# Ownership And Tenancy Refactor Contract

## Purpose

This document defines the canonical ownership model for tenancy, surfaces, multihome URLs, and module placement.
It is the source of truth for implementation work.

## Goals

1. Single owner for tenancy policy and workspace semantics.
2. Single owner for shell behavior and placement orchestration.
3. Kernel reduced to generic, reusable primitives.
4. No hidden fallbacks, no shims, no back-compat layers.
5. Deterministic behavior across `none`, `personal`, and `workspace`.

## Root Cause

Tenancy behavior currently spans multiple layers:

1. `kernel` contains tenancy/surface policy logic and workspace path assumptions.
2. `shell-web` also composes/parses workspace paths and surface behavior.
3. `users-*` owns workspace domain policy and runtime semantics.

This duplicates policy and creates drift risk.

## Canonical Ownership

### `users-*` (policy owner)

Owns:

1. Tenancy semantics (`none`, `personal`, `workspace`).
2. Workspace identity model (slug rules, access rules, membership rules).
3. Workspace provisioning policy (auto-provision or not).
4. API capability gating by tenancy mode.
5. Bootstrap policy payload consumed by UI.

Must not:

1. Own generic shell layout behavior.
2. Own low-level surface routing primitives.

### `shell-web` (shell/placement owner)

Owns:

1. Placement engine and matching semantics.
2. Surface-role based placement resolution.
3. Shell navigation helpers that consume canonical policy/config.
4. Tenancy-aware scaffolding decisions in create-app templates.

Must not:

1. Define workspace business policy.
2. Invent tenancy semantics independent of `users-*`.

### `kernel` (generic primitives owner)

Owns:

1. Generic routing/container/surface primitives.
2. Generic path normalization and registry mechanics.
3. Generic guard/filter utilities.

Must not:

1. Be policy source for tenancy behavior.
2. Encode app-domain workspace semantics.

## Explicit Moves Out Of Kernel

The following responsibilities must be removed from `kernel` ownership and treated as external policy inputs.

1. Tenancy policy decisions (`none/personal/workspace` behavior semantics) -> move to `users-core`.
2. Workspace provisioning policy (`autoProvisionWorkspace`, self-create allowance) -> move to `users-core`.
3. Workspace domain constraints (who can access what workspace, slug policy semantics) -> move to `users-core`.
4. Product-level surface role meaning (`workspace.main`, `workspace.admin`, `console.global`) -> move to `shell-web` + app config contract.
5. Module placement policy semantics (which features appear on which semantic surfaces) -> move to `shell-web` placement role resolution and module declarations.

Kernel remains responsible only for generic mechanics:

1. Surface registry + normalization primitives.
2. Generic route filtering and guard plumbing.
3. Generic path helpers that do not decide business policy.

Guardrails:

1. Kernel APIs may accept resolved policy/config values, but must not derive tenancy business rules internally.
2. Any new tenancy behavior requirement must be implemented in `users-*` and consumed by shell/kernel, not added directly to kernel.
3. If a kernel change mentions tenancy mode semantics, it must be rejected unless it is purely structural and policy-agnostic.

## Tenancy Mode Contract

Username is immutable.

### `none`

1. No workspace semantics.
2. No workspace context resolution.
3. No workspace selector behavior.
4. Surfaces: app + console (non-workspace).
5. No admin-by-default requirement.

### `personal`

1. Exactly one workspace per user.
2. Workspace is auto-provisioned for user lifecycle.
3. Workspace slug is tied to immutable username.
4. Detached workspace creation is not allowed.
5. Workspace and admin surfaces are workspace-scoped; console remains non-workspace.

### `workspace`

1. Multi-workspace membership model.
2. No auto-provision on user creation.
3. Detached workspace creation policy follows product rule:
   1. Current rule in discussion: no self-create.
   2. If changed later, this must be an explicit policy flag in the tenancy profile.
4. Workspace and admin surfaces are workspace-scoped; console remains non-workspace.

## Surface Naming And Placement Stability

Surface IDs are app-defined and may be renamed.
Module code must not rely on hardcoded IDs like `app` or `admin`.

### Required abstraction: Surface Roles

Define stable semantic roles (example):

1. `workspace.main`
2. `workspace.admin`
3. `console.global`
4. `app.global`

Roles map to concrete surface IDs in app config.

### Placement contract

For non-global module placements:

1. Require semantic target (`targetSurfaceRole`).
2. Resolve role -> surface ID at runtime.
3. Fail closed on missing/invalid role mapping.

`surface: "*"` is allowed only for truly global widgets.

## URL And Routing Rules

1. Workspace URL shape is canonical and deterministic.
2. URL builders/parsers must have a single authoritative implementation path per layer.
3. No ad hoc `/w/...` string building in module code.
4. Modules navigate via shared link helpers, not manual path concatenation.

## Canonical Data Contract To UI

Bootstrap payload must expose tenancy profile, not only raw mode string.

Minimum contract:

1. `tenancy.mode`
2. `tenancy.workspace.enabled`
3. `tenancy.workspace.autoProvision`
4. `tenancy.workspace.allowSelfCreate`
5. `tenancy.workspace.slugPolicy`
6. `surfaceRoles` (resolved semantic role map)

UI and modules consume this contract for visibility, placement behavior, and route affordances.

## Behavioral Matrix Enforcement

Enforce behavior in both route registration and service execution.

1. Do not rely only on runtime errors from service layer if route should not exist for a mode.
2. If a feature is disabled by tenancy mode, its route/action should be absent or rejected consistently.

## Module Authoring Rules

1. Modules must declare placement targets semantically (role-based).
2. Modules must use shared link resolver utilities.
3. Modules must not assume specific surface IDs or prefixes.
4. Modules must gate workspace-scoped UI via tenancy/profile context.

## Refactor Phases

### Phase 1: Contracts

1. Introduce canonical tenancy profile contract in `users-core`.
2. Introduce surface role map contract consumed by shell-web.
3. Document role resolution and fail-closed behavior.

### Phase 2: Policy Centralization

1. Move all tenancy policy decisions to `users-core`.
2. Align provisioning/create/list/resolve behavior to mode contract.
3. Ensure route registration reflects policy.

### Phase 3: Shell And Placement

1. Add role-based placement targeting in `shell-web`.
2. Keep `surface: "*"` semantics for global only.
3. Wire resolver into placement runtime and link helpers.

### Phase 4: Scaffolding

1. Make create-app templates mode-aware.
2. Generate pages/placements by tenancy profile + surface roles.
3. Remove hardcoded assumptions in template mutations.

### Phase 5: Module Migration

1. Update `users-web`, `assistant`, `auth-web` placements to role-based targeting.
2. Replace hardcoded surface IDs where required.
3. Verify route availability and UI visibility across all modes.

### Phase 6: Verification

1. Add mode matrix tests:
   1. route registration,
   2. action permissions,
   3. provisioning behavior,
   4. placement visibility,
   5. navigation link generation.
2. Add fail-closed tests for missing role mapping.

## Non-Negotiable Constraints

1. No back-compat shim layers.
2. No hidden fallback to guessed surface IDs.
3. No duplicated policy branches across layers.
4. Keep code junior-readable and explicit.

## Definition Of Done

1. Tenancy policy has one authoritative owner (`users-*`).
2. Shell and placement behavior consume policy, do not redefine it.
3. Modules target semantic surface roles, not raw surface IDs.
4. Mode matrix behavior is deterministic and test-covered.
5. No duplicated multihome URL logic drifting across packages.
