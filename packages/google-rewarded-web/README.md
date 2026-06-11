# @jskit-ai/google-rewarded-web

Client runtime package for Google rewarded unlock gates.

## What It Installs

This package installs:

- a client provider that mounts the rewarded gate host once
- a runtime token: `google-rewarded.web.runtime`
- a composable: `useGoogleRewardedRuntime()`

The gate host is mounted from the provider and does not depend on placements or page-level route hacks.

## Runtime API

App feature code should not talk to GPT directly.

Use the runtime:

```js
const rewarded = useGoogleRewardedRuntime();

const result = await rewarded.requireUnlock({
  gateKey: "progress-logging",
  workspaceSlug
});
```

`requireUnlock()` resolves in four normal cases:

- already unlocked
- reward granted
- user closed the ad without reward
- provider unavailable / load failure

The runtime opens a fullscreen prompt first, then starts the rewarded ad flow only after the user opts in.

Day 0 is intentionally app-surface-only. The runtime does not accept a caller-provided surface override.

## Google Integration

Day 0 is Google-only and uses GPT rewarded ads for web.

The runtime relies on the rewarded slot lifecycle around:

- `rewardedSlotReady`
- `rewardedSlotGranted`
- `rewardedSlotClosed`

`rewardedSlotGranted` is the authoritative unlock trigger. The runtime then calls the server `grant` endpoint before resolving the gate as granted.

## Failure Behavior

If Google cannot provide a rewarded slot:

- the gate stays unresolved
- the runtime enters an error phase
- dismissing the error closes the started watch session through the server `close` endpoint

This keeps the session lifecycle explicit instead of leaving abandoned started rows behind.

## Dependency

This package expects `@jskit-ai/google-rewarded-core` to be installed as well.
