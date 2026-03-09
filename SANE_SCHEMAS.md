# SANE SCHEMAS

## Purpose
Define and execute a single, shared schema system for client and server:
1. One canonical operation contract per resource/command.
2. Shared schema + normalization + validation messages.
3. Explicit HTTP verb semantics (`create`, `replace`, `patch`, `view`, `list`).
4. Zero shims, zero parallel schema systems.

This document is the migration plan and execution checklist.

## Non-Negotiables
1. No backward-compat layers, no dual schema paths.
2. One source of truth per operation.
3. Validation messages are shared and mandatory.
4. Junior-readable naming and structure.
5. No endpoint-specific ad-hoc validation in screens/services when covered by contract.

## Locked Decisions
1. Resource contracts include operation keys:
   1. `view`
   2. `list`
   3. `create`
   4. `replace`
   5. `patch`
2. Verb mapping:
   1. `create` -> `POST`
   2. `replace` -> `PUT`
   3. `patch` -> `PATCH`
   4. `view/list` -> `GET`
3. Commands are separate contracts, not fake CRUD.
4. Every operation defines:
   1. Input sections (`params`, `query`, `body`) as needed
   2. `response`
   3. Shared `messages`
   4. Shared parser flow (`normalize` + schema validation + field error map)

## Canonical Contract Shape

```js
export const workspaceSettingsContract = {
  resource: "workspaceSettings",
  operations: {
    view: {
      method: "GET",
      params: { schema: viewParamsSchema, normalize: normalizeViewParams },
      query: { schema: viewQuerySchema, normalize: normalizeViewQuery },
      response: { schema: recordSchema },
      messages: viewMessages
    },
    list: {
      method: "GET",
      query: { schema: listQuerySchema, normalize: normalizeListQuery },
      response: { schema: listSchema },
      messages: listMessages
    },
    create: {
      method: "POST",
      body: { schema: createSchema, normalize: normalizeCreateBody },
      response: { schema: createResponseSchema },
      messages: createMessages
    },
    replace: {
      method: "PUT",
      body: { schema: replaceSchema, normalize: normalizeReplaceBody },
      response: { schema: replaceResponseSchema },
      messages: replaceMessages
    },
    patch: {
      method: "PATCH",
      body: { schema: patchSchema, normalize: normalizePatchBody },
      response: { schema: patchResponseSchema },
      messages: patchMessages
    }
  }
};
```

Command shape:

```js
export const workspaceInviteCreateCommandContract = {
  command: "workspace.invite.create",
  operation: {
    method: "POST",
    body: { schema: inputSchema, normalize: normalizeInput },
    response: { schema: outputSchema },
    messages: commandMessages
  }
};
```

## Standard Parse Result Shape
All operation parsers must return:

```js
{
  ok: boolean,
  value: object,          // normalized, validated payload ready for use
  fieldErrors: object,    // { [fieldName]: string }
  globalErrors: string[]  // optional
}
```

## Naming and Placement
### File naming
1. Domain-first names, never verb-first names.
2. Forbidden pattern for canonical files: `*Patch.js`, `*Put.js`, `*Post.js`.
3. Resource schema contracts use: `<resource>Schema.js`.
4. Command contracts use: `<command>Command.js`.
5. Export names match file names:
   1. `workspaceSettingsSchema` from `workspaceSettingsSchema.js`
   2. `workspaceInviteRedeemCommand` from `workspaceInviteRedeemCommand.js`

### Directory layout
1. Resource/command contracts live in shared:
   1. `src/shared/contracts/resources/<resource>Schema.js`
   2. `src/shared/contracts/commands/<command>Command.js`
2. Package-level index files expose only canonical contracts.

## Target File Map
This is the concrete file target for migration. Creation is stage-scoped, not all-at-once.

### Stage 1: Foundation (shared parser/message runtime)
1. `packages/http-runtime/src/shared/contracts/operationValidation.js`
2. `packages/http-runtime/src/shared/contracts/operationMessages.js`
3. `packages/http-runtime/test/operationValidation.test.js`
4. `packages/http-runtime/test/operationMessages.test.js`

### Stage 4: Resource contracts
1. `packages/users-core/src/shared/contracts/resources/workspaceSchema.js`
2. `packages/users-core/src/shared/contracts/resources/workspaceSettingsSchema.js`
3. `packages/users-core/src/shared/contracts/resources/workspaceMemberSchema.js`
4. `packages/users-core/src/shared/contracts/resources/workspaceInviteSchema.js`
5. `packages/users-core/src/shared/contracts/resources/userProfileSchema.js`
6. `packages/users-core/src/shared/contracts/resources/userSettingsSchema.js`
7. `packages/users-core/src/shared/contracts/resources/consoleSettingsSchema.js`

### Stage 3 and Stage 5: Command contracts
1. `packages/users-core/src/shared/contracts/commands/workspaceInviteRedeemCommand.js`
2. `packages/users-core/src/shared/contracts/commands/settingsPasswordChangeCommand.js`
3. `packages/users-core/src/shared/contracts/commands/settingsPasswordMethodToggleCommand.js`
4. `packages/users-core/src/shared/contracts/commands/settingsOAuthLinkStartCommand.js`
5. `packages/users-core/src/shared/contracts/commands/settingsOAuthUnlinkCommand.js`
6. `packages/users-core/src/shared/contracts/commands/settingsLogoutOtherSessionsCommand.js`
7. `packages/users-core/src/shared/contracts/commands/settingsAvatarUploadCommand.js`
8. `packages/users-core/src/shared/contracts/commands/settingsAvatarDeleteCommand.js`

### Explicit Non-Targets (no contract barrels)
1. Do not create `packages/users-core/src/shared/contracts/resources/index.js`
2. Do not create `packages/users-core/src/shared/contracts/commands/index.js`
3. Do not create `packages/users-core/src/shared/contracts/index.js`

### Classification note
1. `workspace.invite.create` and `workspace.invite.revoke` remain resource operations on `workspaceInviteSchema`, not command contracts.

## Stages

## Stage 0: Baseline Inventory
Goal: identify all schema/normalization/message sources currently in use.

Tasks:
1. Inventory resource and command endpoints in `users-routes`.
2. Inventory parser/normalizer files in `users-core`.
3. Inventory route `body/query/params` schema usage.
4. Inventory any duplicate tool schemas (`*_TOOL_SCHEMA` constants).
5. Inventory client-side parser usage in `users-web`.

Deliverables:
1. Endpoint-to-source matrix (one row per endpoint).
2. Drift report: where more than one source exists for same operation.

Exit criteria:
1. Every endpoint is mapped.
2. Drift hotspots are explicitly listed and prioritized.

Status: `COMPLETED`

## Stage 1: Contract Runtime Primitives
Goal: provide shared utilities to consume operation contracts the same way on client and server.

Tasks:
1. Add shared operation parser helper:
   1. `normalize -> validate -> map field errors -> result`.
2. Add shared issue-to-message mapper (`keyword + field`).
3. Add helpers to select operation by verb (`create/replace/patch/view/list`).
4. Add tests for primitives in `http-runtime` (or kernel-shared if chosen).

Deliverables:
1. Minimal runtime helpers with explicit API.
2. Unit tests for happy/invalid edge cases.

Exit criteria:
1. Parser helper works with TypeBox schemas.
2. Messages are deterministic across client/server.

Status: `COMPLETED`

## Stage 2: Pilot Contract (Workspace Settings)
Goal: migrate one end-to-end feature completely and use as template.

Scope:
1. `workspace.settings.read`
2. `workspace.settings.update`

Tasks:
1. Create canonical contract file for workspace settings.
2. Move schema + normalization + messages into that contract.
3. Remove `workspaceSettingsPatch.js` naming (replace with domain contract naming).
4. Server route uses contract operation sections for request/response.
5. Service/action uses contract parser result (no duplicate logic).
6. Client `WorkspaceSettingsClientElement` uses same parser/messages through `useWorkspaceAddEdit`.

Deliverables:
1. One complete contract-driven feature.
2. Migration notes/template extracted from pilot.

Exit criteria:
1. No duplicated schema source remains for workspace settings.
2. Client/server behavior matches with shared messages.
3. Tests pass.

Status: `COMPLETED`

## Stage 3: Commands Pilot (Workspace Invite Create/Redeem)
Goal: apply same contract model to command endpoints.

Scope:
1. `workspace.invite.create`
2. `workspace.invite.redeem`

Tasks:
1. Define command contracts with input/output/normalize/messages.
2. Remove standalone command tool schema constants.
3. Wire server routes/actions to command contracts.
4. Wire client command composables to same contracts.

Exit criteria:
1. No command endpoint in pilot uses a second schema definition path.
2. Command error messages are shared.

Status: `IN PROGRESS`

## Stage 4: Full Resource Rollout
Goal: migrate all listed resources to canonical contracts.

Resources:
1. `workspace`
2. `workspaceSettings`
3. `workspaceMember`
4. `workspaceInvite`
5. `userProfile`
6. `userSettings`
7. `consoleSettings`

Tasks:
1. Move each resource to one contract file.
2. Replace route schema references with operation contract references.
3. Replace parser references in services/actions with operation parser helper usage.
4. Ensure operation messages are complete and shared.

Exit criteria:
1. Every resource operation is contract-driven.
2. No legacy parser naming remains in migrated resources.

Status: `IN PROGRESS`

## Stage 5: Full Command Rollout
Goal: migrate all command endpoints to canonical command contracts.

Commands:
1. `workspace.invite.redeem`
2. `settings.security.password.change`
3. `settings.security.password_method.toggle`
4. `settings.security.oauth.link.start`
5. `settings.security.oauth.unlink`
6. `settings.security.sessions.logout_others`
7. `settings.profile.avatar.upload`
8. `settings.profile.avatar.delete`

Tasks:
1. Build command contract files with shared operation shape.
2. Remove duplicate tool schema constants.
3. Wire controller/action execution to command parser helpers.
4. Wire `use*Command` callers to contract messages/parser.

Exit criteria:
1. Every command has one contract source.
2. Assistant tool input schemas come from canonical command contracts.

Status: `IN PROGRESS`

## Stage 6: Composable Integration and API Simplification
Goal: make `use*` composables contract-first to remove ad-hoc parser wiring.

Tasks:
1. Update core composables to accept operation contracts directly:
   1. `useAddEditCore`
   2. `useViewCore`
   3. `useListCore`
   4. `useCommandCore`
2. Update scope wrappers (`workspace/account/global`) to pass operation contracts.
3. Reduce screen API to feature-only mapping hooks where needed.

Exit criteria:
1. Screens do not manually wire schema/parsers for standard operations.
2. `parseInput` function injection is only needed for explicit edge cases.

Status: `NOT STARTED`

## Stage 7: Cleanup and Enforcement
Goal: prevent schema drift from reappearing.

Tasks:
1. Delete deprecated schema/parser files.
2. Add tests that fail on duplicate schema sources per endpoint.
3. Add tests that ensure route body/query/params schemas come from contracts.
4. Add tests that ensure shared messages are present for each operation.
5. Update docs and templates to canonical usage only.

Exit criteria:
1. No duplicate schema systems remain.
2. Contract compliance checks are automated.
3. Team docs reflect final model.

Status: `IN PROGRESS`

## Migration Order Recommendation
1. Stage 0
2. Stage 1
3. Stage 2
4. Stage 3
5. Stage 4
6. Stage 5
7. Stage 6
8. Stage 7

## Risks and Mitigations
1. Risk: hidden behavior changes during normalization move.
   1. Mitigation: snapshot tests on parser outputs before/after migration.
2. Risk: message text drift during file moves.
   1. Mitigation: message parity tests.
3. Risk: partial rollout causes mixed patterns.
   1. Mitigation: stage gates; no stage marked complete without exit criteria.

## Definition of Done
1. Every resource/command operation uses one canonical contract definition.
2. Client and server both consume the same schema/normalize/messages.
3. No endpoint keeps duplicate ad-hoc tool schema constants.
4. No verb-named domain contract files remain.
5. Tests enforce all of the above.
