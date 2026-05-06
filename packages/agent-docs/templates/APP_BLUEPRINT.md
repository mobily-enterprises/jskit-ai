# App Blueprint

## Product

- App purpose:
- Primary users:
- Success criteria:

## Platform Choices

- Tenancy mode:
- Database engine:
- Auth provider:
- Optional extras: realtime / assistant / uploads / other

## Actors And Access

- Actor list:
- Permission boundaries:
- Console/admin-only areas:

## Surfaces

- Global surfaces:
- Workspace surfaces:
- Settings surfaces:

## Data Model

| Entity | Purpose | Ownership | Notes |
| --- | --- | --- | --- |
| | | | |

## Route And Screen Plan

- Home/global routes:
- Account routes:
- Console routes:
- Workspace app routes:
- Workspace admin routes:

## Package Plan

- Baseline runtime packages:
- Optional runtime packages:
- Generator packages to use:
- Package-owned workflows to accept as baseline:
- Package-owned workflows to override or extend:

## Implementation Notes

- CRUDs to scaffold:
- Non-CRUD pages to scaffold:
- Custom code areas:

## CRUD Planning

| CRUD | Operations | List Fields | View Form Shape | Edit/New Form Shape | Notes |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

## Delivery Plan

| Chunk | Goal | Type | Depends on | Done when |
| --- | --- | --- | --- | --- |
| | | | | |

Chunk notes:

- One CRUD is usually one chunk.
- Platform/auth/shell work may be its own chunk.
- Prefer vertical slices that produce visible or end-to-end progress the developer can inspect.
- Each chunk must be independently reviewable and testable.

## Verification

- Commands to run:
- Playwright coverage plan:
- Test auth strategy:
- UI review expectations:
- Known open questions:
