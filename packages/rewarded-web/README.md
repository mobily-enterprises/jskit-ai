# @jskit-ai/rewarded-web

Client workflow and gate UI for application-owned rewards. The package requires
`client.vue` and an explicit `client.rewarded-delivery` capability. Installing it
does not load an ad SDK or select a provider.

## Application use

```js
const rewarded = useRewardedRuntime();
const result = await rewarded.requireUnlock({ gateKey: "bonus", workspaceSlug });
```

The workflow opens a prompt before delivery. It handles existing unlocks, grants,
closed sessions and unavailable delivery through the app's `/rewarded/*` routes.
The delivery capability supplies `launchReward({ providerConfig, onReady,
onGranted, onClosed, onUnavailable })`, returning a promise for its lifecycle.
Provider configuration is opaque to the workflow. The application authorizes
server grants; browser callbacks alone do not prove provider viewing.

The existing gate is app-surface-only. The installed provider mounts its host
and supplies `client.rewarded`; direct callers use `createRewardedRuntime({
launchReward })`. Missing delivery fails rather than selecting Google.

## Google delivery pattern

See [Google rewarded delivery](patterns/google-rewarded/PATTERN.md). Copy the
adapter and provider into the application and register its provider alongside
`RewardedClientProvider`. The example handles Publisher Tag script loading,
rewarded events and slot cleanup. It accepts provider `google-publisher-tag` and
uses the configured placement as the Google ad unit path.

## V0 migration

Replace old package imports, `GoogleRewarded*` symbols and `google-rewarded.*`
capabilities with the generic names. Replace `useGoogleRewardedRuntime()` with
`useRewardedRuntime()` and supply delivery explicitly for direct construction.
There is no compatibility fallback. The core README describes table, route and
configuration migration. Install `@jskit-ai/rewarded-core` for server workflow
ownership; the Google example remains application source.

The package manifest lists application-owned inputs in both `capabilities.requires`
and `capabilities.applicationRequires`. The latter identifies who supplies them;
it does not make the runtime dependency optional or provide a default.
