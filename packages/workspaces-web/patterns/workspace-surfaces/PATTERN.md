---
id: workspaces/workspace-surfaces
title: Workspace application and administration surfaces
summary: Compose workspace selection, invitation, member administration, settings, and responsive navigation using JSKIT workspace web APIs.
keywords: admin, invite, member, navigation, settings, surface, switcher, workspace
requires: @jskit-ai/workspaces-core, @jskit-ai/workspaces-web, @jskit-ai/shell-web
---

# Workspace application and administration surfaces

## Use when

Use this pattern when the product has workspace-scoped app and administration
surfaces, invitations, member management, or workspace switching.

## Do not use when

Do not use this pattern for a single-owner application, or copy its whole
surface tree when only one workspace widget is needed.

## Product decisions

Choose public invitation routes, application/admin surface ids, workspace
selector behavior, member-management permissions, settings sections, and the
empty or not-found experience.

## Framework APIs

Use the workspace client provider, components, and composables exported by
`@jskit-ai/workspaces-web` together with JSKIT shell placements and routes.

## Invariants

- Route workspace slug, selected workspace, and server scope stay synchronized.
- Route and surface pages do not add a page header or standalone heading by
  default.
- Invitation acceptance is public only where the server contract permits it.
- Administrative UI visibility never substitutes for server authorization.
- Query and route state hydrate immediately on warm-cache navigation.
- Loading uses skeletons; mutation failures use toasts without layout movement.
- Navigation is composed through semantic placements and registered tokens.

## Example files

`example/` contains workspace app/admin roots, starter pages, invitation route,
member and settings routes, not-found state, app-owned invitation widgets, and
the components that an application's client provider registers.

## Variation points

Change surfaces, routes, section owners, labels, icons, placement order,
workspace-not-found copy, member operations, and invitation presentation.

## Verification

Exercise direct workspace URLs, selection and switching, invitations, members,
settings, not-found state, browser back/forward, forbidden access, and all
responsive navigation variants.

## Avoid

- defaulting silently to another workspace after an invalid route
- unscoped queries
- inline mutation error banners
- generated placement or source mutation machinery
