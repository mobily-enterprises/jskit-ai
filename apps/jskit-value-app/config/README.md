# Config Reference (`apps/jskit-value-app/config`)

Canonical reference for repository-owned config defaults and validation rules.

## Sources

- Defaults: `app.js`, `chat.js`, `ai.js`, `billing.js`, `retention.js`
- Validation and merge rules: `index.js`
- Validator semantics: `lib/helpers.js`

## Global Rules (All Domains)

| Rule | Allowed values / behavior | Where enforced |
| --- | --- | --- |
| Boolean fields | `true` or `false` | `expectBoolean(...)` |
| Positive integer fields | Integer `>= 1` | `expectPositiveInteger(...)` (default `min=1`) |
| String fields | String, trimmed non-empty | `expectString(...)` |
| `ai.requiredPermission` | String, empty string allowed | `expectString(..., { allowEmpty: true })` |
| Enum fields | Must match one listed value exactly | `expectOneOf(...)` |
| Object fields | Plain object only (not `null`, not array) | `expectPlainObject(...)` |
| Overrides | Must be plain object; unknown keys rejected at any level | `mergePlainObjectOverrides(...)` |
| Override arrays | Arrays are rejected as override objects | `mergePlainObjectOverrides(...)` |
| Final config mutability | Deep-frozen (immutable) | `deepFreeze(...)` |

## Root Shape

Repository config has exactly these top-level slices:

- `app`
- `chat`
- `ai`
- `billing`
- `retention`

`buildRepositoryConfig(...)` loads defaults, merges optional overrides, validates, then deep-freezes.

## `app` Domain

| Key path | Type | Allowed values | Default | Meaning | Notable constraints/interactions |
| --- | --- | --- | --- | --- | --- |
| `app.tenancyMode` | enum string | `personal`, `team-single`, `multi-workspace` | `"team-single"` | Workspace tenancy model. | Must match enum exactly. |
| `app.workspaceProvisioningMode` | enum string | `self-serve`, `governed` | `"self-serve"` | Workspace provisioning policy mode. | Must match enum exactly. Pair with `app.features.workspaceCreateEnabled` intentionally. |
| `app.features` | object | Plain object | `{...}` | Feature-gate group for workspace behavior. | Required object; cannot be array/null. |
| `app.features.workspaceSwitching` | boolean | `true` or `false` | `false` | Enables/disables workspace switching UX/policy flag. | No cross-field validator in `config/index.js`. |
| `app.features.workspaceInvites` | boolean | `true` or `false` | `true` | Enables/disables workspace invite flows. | No cross-field validator in `config/index.js`. |
| `app.features.workspaceCreateEnabled` | boolean | `true` or `false` | `true` | Enables/disables workspace creation flows. | No cross-field validator in `config/index.js`. |
| `app.limits` | object | Plain object | `{...}` | App-level numeric limits. | Required object; cannot be array/null. |
| `app.limits.maxWorkspacesPerUser` | integer | `>= 1` | `1` | Maximum workspaces a user may belong to/create by policy. | Integer only; no upper bound in validator. |

## `chat` Domain

| Key path | Type | Allowed values | Default | Meaning | Notable constraints/interactions |
| --- | --- | --- | --- | --- | --- |
| `chat.enabled` | boolean | `true` or `false` | `true` | Master toggle for chat subsystem behavior. | Must be boolean. |
| `chat.workspaceThreadsEnabled` | boolean | `true` or `false` | `true` | Enables thread model scoped to workspaces. | Must be boolean. |
| `chat.globalDmsEnabled` | boolean | `true` or `false` | `true` | Enables cross-workspace/global DMs. | Must be boolean. |
| `chat.globalDmsRequireSharedWorkspace` | boolean | `true` or `false` | `true` | Requires DM participants to share a workspace. | Meaningful when `chat.globalDmsEnabled` is `true`. |
| `chat.attachmentsEnabled` | boolean | `true` or `false` | `true` | Enables file attachments in chat messages. | Attachment limits still validate even if disabled. |
| `chat.messageMaxTextChars` | integer | `>= 1` | `4000` | Max characters per message body. | Integer only; no upper bound in validator. |
| `chat.messagesPageSizeMax` | integer | `>= 1` | `100` | Max page size for message list APIs. | Integer only; no upper bound in validator. |
| `chat.threadsPageSizeMax` | integer | `>= 1` | `50` | Max page size for thread list APIs. | Integer only; no upper bound in validator. |
| `chat.attachmentsMaxFilesPerMessage` | integer | `>= 1` | `5` | Max number of files attached to one message. | Integer only; no upper bound in validator. |
| `chat.attachmentMaxUploadBytes` | integer | `>= 1` | `20000000` | Max size per uploaded attachment in bytes. | Integer only; no upper bound in validator. |
| `chat.unattachedUploadRetentionHours` | integer | `>= 1` | `24` | Retention window for uploads not linked to a message. | Integer only; no upper bound in validator. |

## `ai` Domain

| Key path | Type | Allowed values | Default | Meaning | Notable constraints/interactions |
| --- | --- | --- | --- | --- | --- |
| `ai.enabled` | boolean | `true` or `false` | `true` | Master toggle for AI features. | Must be boolean. |
| `ai.model` | string | Non-empty trimmed string | `"deepseek-chat"` | Model identifier used by AI service layer. | Empty/whitespace-only strings are invalid. |
| `ai.maxInputChars` | integer | `>= 1` | `8000` | Max chars accepted as AI input payload. | Integer only; no upper bound in validator. |
| `ai.maxHistoryMessages` | integer | `>= 1` | `20` | Max history messages included in AI context. | Integer only; no upper bound in validator. |
| `ai.maxToolCallsPerTurn` | integer | `>= 1` | `4` | Max tool calls allowed in one AI turn. | Integer only; no upper bound in validator. |
| `ai.streamTimeoutMs` | integer | `>= 1` | `90000` | Client runtime timeout for one assistant stream request. | Consumed by `assistant-client-runtime` policy injection. |
| `ai.historyPageSize` | integer | `>= 1` | `100` | Client runtime page size when listing conversation history. | Consumed by `assistant-client-runtime` policy injection. |
| `ai.restoreMessagesPageSize` | integer | `>= 1` | `200` | Client runtime page size when restoring one conversation timeline. | Consumed by `assistant-client-runtime` policy injection. |
| `ai.requiredPermission` | string | Any string, including `""` | `""` | Optional RBAC permission required to use AI. | Empty string means no explicit permission gate at config level. |

## `billing` Domain

| Key path | Type | Allowed values | Default | Meaning | Notable constraints/interactions |
| --- | --- | --- | --- | --- | --- |
| `billing.enabled` | boolean | `true` or `false` | `true` | Master toggle for billing subsystem policy. | Must be boolean. |
| `billing.provider` | enum string | `stripe`, `paddle` | `"stripe"` | Billing provider integration mode. | Must match enum exactly. |
| `billing.currency` | string | Non-empty trimmed string | `"USD"` | Billing currency code/value used by policy layer. | Validator does not enforce ISO format. |
| `billing.idempotency` | object | Plain object | `{...}` | Billing idempotency timing settings. | Required object; cannot be array/null. |
| `billing.idempotency.providerReplayWindowSeconds` | integer | `>= 1` | `82800` | Provider replay window (seconds). | Integer only; no upper bound in validator. |
| `billing.idempotency.pendingLeaseSeconds` | integer | `>= 1` | `120` | Lease duration for pending idempotent operations (seconds). | Integer only; no upper bound in validator. |
| `billing.checkout` | object | Plain object | `{...}` | Checkout timing policy settings. | Required object; cannot be array/null. |
| `billing.checkout.providerExpiresSeconds` | integer | `>= 1` | `86400` | Provider checkout session expiry (seconds). | Integer only; no upper bound in validator. |
| `billing.checkout.sessionExpiresAtGraceSeconds` | integer | `>= 1` | `90` | Grace period around checkout session expiry checks (seconds). | Integer only; no upper bound in validator. |
| `billing.checkout.completionSlaSeconds` | integer | `>= 1` | `300` | Target completion window for checkout processing (seconds). | Integer only; no upper bound in validator. |
| `billing.workers` | object | Plain object | `{...}` | Billing worker retry/timing settings. | Required object; cannot be array/null. |
| `billing.workers.outbox` | object | Plain object | `{...}` | Outbox worker retry policy. | Required object; cannot be array/null. |
| `billing.workers.outbox.retryDelaySeconds` | integer | `>= 1` | `60` | Delay between outbox retries (seconds). | Integer only; no upper bound in validator. |
| `billing.workers.outbox.maxAttempts` | integer | `>= 1` | `8` | Max outbox retry attempts. | Integer only; no upper bound in validator. |
| `billing.workers.remediation` | object | Plain object | `{...}` | Remediation worker retry policy. | Required object; cannot be array/null. |
| `billing.workers.remediation.retryDelaySeconds` | integer | `>= 1` | `120` | Delay between remediation retries (seconds). | Integer only; no upper bound in validator. |
| `billing.workers.remediation.maxAttempts` | integer | `>= 1` | `6` | Max remediation retry attempts. | Integer only; no upper bound in validator. |
| `billing.retention` | object | Plain object | `{...}` | Billing retention policy settings. | Required object; cannot be array/null. |
| `billing.retention.idempotencyDays` | integer | `>= 1` | `30` | Retention window for billing idempotency records (days). | Integer only; no upper bound in validator. |
| `billing.retention.webhookPayloadDays` | integer | `>= 1` | `30` | Retention window for billing webhook payload records (days). | Integer only; no upper bound in validator. |

## `retention` Domain

| Key path | Type | Allowed values | Default | Meaning | Notable constraints/interactions |
| --- | --- | --- | --- | --- | --- |
| `retention.errorLogDays` | integer | `>= 1` | `30` | Retention period for error log artifacts (days). | Integer only; no upper bound in validator. |
| `retention.inviteArtifactDays` | integer | `>= 1` | `90` | Retention period for workspace invite artifacts (days). | Integer only; no upper bound in validator. |
| `retention.securityAuditDays` | integer | `>= 1` | `365` | Retention period for security audit records (days). | Integer only; no upper bound in validator. |
| `retention.aiTranscriptsDays` | integer | `>= 1` | `60` | Retention period for AI transcript records (days). | Integer only; no upper bound in validator. |
| `retention.chat` | object | Plain object | `{...}` | Chat-specific retention settings. | Required object; cannot be array/null. |
| `retention.chat.messagesDays` | integer | `>= 1` | `365` | Retention period for chat messages (days). | Integer only; no upper bound in validator. |
| `retention.chat.attachmentsDays` | integer | `>= 1` | `365` | Retention period for chat attachments (days). | Integer only; no upper bound in validator. |
| `retention.chat.messageIdempotencyRetryWindowHours` | integer | `>= 1` | `72` | Retry window for message idempotency keys (hours). | Integer only; no upper bound in validator. |
| `retention.chat.emptyThreadCleanupEnabled` | boolean | `true` or `false` | `false` | Enables cleanup of empty chat threads. | Must be boolean. |

## Quick Profiles

These are example app-policy presets for readability. They are not special runtime modes.

### Personal

```js
{
  app: {
    tenancyMode: "personal",
    workspaceProvisioningMode: "self-serve",
    features: {
      workspaceSwitching: false,
      workspaceInvites: false,
      workspaceCreateEnabled: false
    },
    limits: {
      maxWorkspacesPerUser: 1
    }
  }
}
```

### Team Single

```js
{
  app: {
    tenancyMode: "team-single",
    workspaceProvisioningMode: "self-serve",
    features: {
      workspaceSwitching: false,
      workspaceInvites: true,
      workspaceCreateEnabled: true
    },
    limits: {
      maxWorkspacesPerUser: 1
    }
  }
}
```

### Multi Workspace

```js
{
  app: {
    tenancyMode: "multi-workspace",
    workspaceProvisioningMode: "self-serve",
    features: {
      workspaceSwitching: true,
      workspaceInvites: true,
      workspaceCreateEnabled: true
    },
    limits: {
      maxWorkspacesPerUser: 25
    }
  }
}
```

### Workspace Provisioning Modes

Self-serve profile:

```js
{
  app: {
    workspaceProvisioningMode: "self-serve",
    features: {
      workspaceCreateEnabled: true
    }
  }
}
```

Governed profile:

```js
{
  app: {
    workspaceProvisioningMode: "governed",
    features: {
      workspaceCreateEnabled: false
    }
  }
}
```

Note: the validator enforces allowed values and types, but does not auto-couple these flags.

## Test-Only Override Hook

For tests only, when `NODE_ENV=test`, `resolveRepositoryConfigForRuntime(...)` honors:

- `globalThis.__JSKIT_TEST_REPOSITORY_CONFIG_OVERRIDE__`

Overrides are merged recursively into defaults and validated with the same schema.
