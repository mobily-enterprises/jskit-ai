# Protecting Server Actions With `requireGoogleRewardedUnlock()`

This is the manual page for the server helper exported by:

```js
@jskit-ai/google-rewarded-core/server/requireGoogleRewardedUnlock
```

Use this helper when a feature is:

- allowed in principle for the actor
- but temporarily gated behind a rewarded unlock

Do not use it as a permission system.

The correct split is:

- permissions decide whether the actor may ever do the thing
- rewarded gates decide whether the actor must unlock the thing right now

## What The Helper Does

`requireGoogleRewardedUnlock()` calls `google-rewarded.core.service.getCurrentState(...)` and then enforces one simple rule:

- if the gate is already unlocked, it returns the gate state
- if the gate is not configured and `requireConfigured` is not enabled, it returns the gate state
- otherwise it throws an `AppError`

This means the helper is a truth-enforcement seam for protected server operations.

The UI should still call the web runtime first for user experience, but the protected server operation must also check the gate so users cannot bypass it by calling the endpoint directly.

## Import Path

```js
import { requireGoogleRewardedUnlock } from "@jskit-ai/google-rewarded-core/server/requireGoogleRewardedUnlock";
```

## Basic Service Pattern

Inject `google-rewarded.core.service` into your own feature service, then call the helper before the protected mutation.

Example:

```js
import { requireGoogleRewardedUnlock } from "@jskit-ai/google-rewarded-core/server/requireGoogleRewardedUnlock";

function createProgressLoggingService({
  googleRewardedService,
  workoutLogRepository
} = {}) {
  async function logProgress(input = {}, options = {}) {
    await requireGoogleRewardedUnlock(
      googleRewardedService,
      {
        gateKey: "progress-logging",
        workspaceSlug: input.workspaceSlug
      },
      {
        context: options.context,
        errorMessage: "Watch a rewarded ad before logging progress."
      }
    );

    return workoutLogRepository.create(input, options);
  }

  return Object.freeze({
    logProgress
  });
}
```

## Provider Wiring Pattern

Inject the rewarded service from the container the same way as any other JSKIT runtime service.

Example:

```js
app.service(
  "convict.progress-logging.service",
  (scope) => createProgressLoggingService({
    googleRewardedService: scope.make("google-rewarded.core.service"),
    workoutLogRepository: scope.make("convict.workout-log.repository")
  })
);
```

## Exact Helper Signature

```js
await requireGoogleRewardedUnlock(
  googleRewardedService,
  {
    gateKey,
    workspaceSlug
  },
  {
    context,
    requireConfigured,
    errorCode,
    errorMessage
  }
);
```

Arguments:

- `googleRewardedService`
  - must expose `getCurrentState(input, { context })`
- first object
  - `gateKey`: required gate identifier
  - `workspaceSlug`: required for the current workspace gate
- second object
  - `context`: the normal JSKIT action/service context
  - `requireConfigured`: fail closed when no rule/provider config exists
  - `errorCode`: optional override for the thrown `AppError.code`
  - `errorMessage`: optional override for the thrown `AppError.message`

## Default Behavior

The helper is intentionally permissive when the rewarded gate is not configured.

By default:

- `reason = "rule-not-configured"` passes
- `reason = "provider-not-configured"` passes

Why:

- day-0 apps may install the package before creating live rules/config rows
- you do not want every protected feature to break during setup or partial rollout

If you want the protected operation to fail closed until configuration exists, set:

```js
requireConfigured: true
```

## When The Helper Throws

The helper throws `AppError` with `details.rewardedGate` containing the full gate state.

Important built-in failure cases:

- `reward-required`
  - status: `423`
  - code: `google_rewarded_unlock_required`
- `cooldown-active`
  - status: `423`
  - code: `google_rewarded_cooldown_active`
- `daily-limit-reached`
  - status: `423`
  - code: `google_rewarded_daily_limit_reached`
- `rule-not-configured` or `provider-not-configured` with `requireConfigured: true`
  - status: `503`
  - code: `google_rewarded_not_configured`

## What The Helper Returns

On success, the helper returns the gate state from `googleRewardedService.getCurrentState(...)`.

That lets your service inspect the unlock window if it wants to log or branch on it, for example:

```js
const gateState = await requireGoogleRewardedUnlock(...);
const unlockedUntil = gateState.unlock?.unlockedUntil || null;
```

## Recommended Calling Order

For a protected feature operation:

1. run normal permission / ownership checks
2. run `requireGoogleRewardedUnlock(...)`
3. perform the real mutation

Do not invert that order.

## What Not To Do

Do not:

- model rewarded gates as permissions
- skip the server check because the client already opened the gate
- rely on route visibility as the rewarded gate
- duplicate the raw `reason` checks in every feature service

Use the helper instead of open-coding that logic.
