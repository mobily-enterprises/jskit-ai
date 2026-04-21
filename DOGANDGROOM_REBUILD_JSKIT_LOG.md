# Dogandgroom Rebuild JSKIT Log

This file records every framework-side change made in `jskit-ai` while rebuilding `dogandgroom` onto the latest JSKIT baseline.

The goal is to give the maintainer a clean review trail separate from app-local migration commits.

## 2026-04-21

### Missing-row normalization in internal workspace repositories

- Problem:
  - the fresh `dogandgroom2` recap baseline could not seed the first local dev user in `personal` tenancy
  - `workspaces.core.profileSyncLifecycleContributor` called `internal.repository.workspaces.findPersonalByOwnerUserId()`
  - that repository wrapper defaulted `undefined` query results to `{}` before normalization, so an empty result was treated as a real row and failed on `is_personal`
- Root cause:
  - several internal repository helper functions used `function normalizeXRecord(payload = {})`
  - their null-guard checked `if (!payload)` after the default parameter had already converted `undefined` into `{}`.
- Fix:
  - remove the default object from the internal record-normalization wrappers so missing rows stay `null`
  - add regression coverage for the workspace path that failed in the fresh baseline
- Files:
  - `packages/workspaces-core/src/server/common/repositories/workspacesRepository.js`
  - `packages/workspaces-core/src/server/common/repositories/workspaceMembershipsRepository.js`
  - `packages/workspaces-core/src/server/common/repositories/workspaceInvitesRepository.js`
  - `packages/users-core/src/server/common/repositories/userProfilesRepository.js`
  - `packages/workspaces-core/test/workspacesRepository.test.js`
  - `packages/users-core/test/repositoryContracts.test.js`
- Verification:
  - `npm test --workspace @jskit-ai/workspaces-core`
  - `npm test --workspace @jskit-ai/users-core` ran, but it still contains an unrelated pre-existing scaffold-version contract failure outside this fix

