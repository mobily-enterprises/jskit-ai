# @jskit-ai/retention-core

Retention orchestration for deleting old operational data in controlled batches.

## What this package is for

Use this package to run scheduled cleanup (retention) jobs, for example:

- old browser/server console errors
- old invites that are already accepted/revoked/expired
- old security audit entries
- old AI transcript rows
- old chat artifacts (messages, detached uploads, tombstones)
- optional billing cleanup hooks

It builds reusable retention rules and executes them through the shared orchestrator in `@jskit-ai/redis-ops-core`.

## Key terms (plain language)

- `retention`: automatically removing old data after a time window.
- `batch`: deleting in chunks (for example 1000 rows at a time) to avoid heavy DB load.
- `cutoff date`: only rows older than this date are eligible.

## Exports

- `@jskit-ai/retention-core`
- `@jskit-ai/retention-core/service`
- `@jskit-ai/retention-core/policy`
- `@jskit-ai/retention-core/rules`

Public runtime API:

- `createService(...)`
- `resolveRetentionPolicyConfig(policy)`
- `buildRetentionPolicyFromRepositoryConfig({ repositoryConfig, batchSize })`
- `createRetentionRulePack({ repositories, retentionConfig })`

`__testables` exports are for tests.

## Function reference

### `resolveRetentionPolicyConfig(policy)`

Normalizes retention settings with safe defaults.

Examples:

- if `chatMessagesRetentionDays` is missing, default is used.
- if `batchSize` is invalid, it is normalized to a safe positive fallback.

Practical use:

- boot code accepts environment/config input and converts it into one strict retention policy object.

### `buildRetentionPolicyFromRepositoryConfig({ repositoryConfig, batchSize })`

Maps app repository config shape into retention policy shape.

Practical use:

- `jskit-value-app` reads repository config and converts it to retention runtime config for workers.

### `createRetentionRulePack({ repositories, retentionConfig })`

Builds the full list of retention rules for all supported domains.

Included rule groups:

- console error rules
- invite artifact rules (workspace + console)
- security audit rules
- AI transcript rules
- chat rules
- optional billing rules

Practical use:

- worker startup creates one consolidated rule pack so a single sweep can process every domain.

### `createService(dependencies)`

Creates a high-level retention service and returns:

- `runSweep({ dryRun, ... })`

Internally it:

1. normalizes policy
2. creates rule pack
3. delegates execution to `createRetentionSweepOrchestrator`

Practical use:

- scheduled worker runs `runSweep()` nightly to keep storage growth under control.

## Real-life end-to-end example

```js
import {
  createService as createRetentionService,
  buildRetentionPolicyFromRepositoryConfig
} from "@jskit-ai/retention-core";

const retentionConfig = buildRetentionPolicyFromRepositoryConfig({ repositoryConfig });

const retentionService = createRetentionService({
  retentionConfig,
  consoleErrorLogsRepository,
  workspaceInvitesRepository,
  consoleInvitesRepository,
  auditEventsRepository,
  aiTranscriptConversationsRepository,
  aiTranscriptMessagesRepository,
  chatThreadsRepository,
  chatParticipantsRepository,
  chatMessagesRepository,
  chatIdempotencyTombstonesRepository,
  chatAttachmentsRepository,
  billingRepository
});

const result = await retentionService.runSweep({ dryRun: false });
```

## How `jskit-value-app` uses it and why

Real usage:

- `apps/jskit-value-app/bin/retentionSweep.js`
- `apps/jskit-value-app/bin/worker.js`
- `apps/jskit-value-app/server/workers/retentionProcessor.js`

Why:

- retention rules are centralized and reused by CLI + worker paths
- policy normalization is consistent between app config and runtime execution
- deleting in batches reduces production risk (large table locks/timeouts)

## Notes about rule factories

Source includes rule factory functions like:

- `createChatRetentionRules`
- `createAuditRetentionRules`
- `createInviteRetentionRules`
- `createConsoleErrorRetentionRules`
- `createAiTranscriptRetentionRules`
- `createBillingRetentionRules`

These are internal composition pieces used by `createRetentionRulePack`.

## Non-goals

- no cron scheduler by itself
- no queue worker lifecycle management by itself
- no DB schema migrations
