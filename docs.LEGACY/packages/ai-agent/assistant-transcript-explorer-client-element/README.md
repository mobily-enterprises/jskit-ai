# `@jskit-ai/assistant-transcript-explorer-client-element`

Shared client element for transcript list/detail exploration across workspace and console scopes.

## What This Package Owns

1. Transcript filters/list panel UI.
2. Transcript conversation detail panel UI.
3. Workspace/console display mode variants.

## What Stays App-Local

1. Data loading and export logic in app composables.
2. Auth/policy checks and route-level access.
3. API clients and backend contracts.

## Required Props

1. `mode` (`workspace | console`)
2. `meta`
3. `state`
4. `actions`

## Optional Props

1. `copy`
2. `variant` (`layout`, `surface`, `density`, `tone`)
3. `features`
4. `ui`

## Events

1. `action:started`
2. `action:succeeded`
3. `action:failed`
4. `interaction`
5. `filters:apply`
6. `transcript:select`
7. `transcript:export`

## Slots

1. `filters-extra`
2. `detail-extra`
3. `footer-extra`

## Variants

1. `layout`: `compact | comfortable`
2. `surface`: `plain | carded`
3. `density`: `compact | comfortable`
4. `tone`: `neutral | emphasized`

## Customization

1. Use `mode` to switch workspace vs console shell copy and filter behavior.
2. Use `copy` for titles/labels/empty-state text overrides.
3. Use `features` to toggle major regions (`listPanel`, `detailPanel`, `memberFilter`, `statusFilter`).
4. Use slots for additional filters/detail/footer augmentation.

## Eject

Raw source export:

- `@jskit-ai/assistant-transcript-explorer-client-element/source/AssistantTranscriptExplorerClientElement.vue`

Example:

```bash
cp node_modules/@jskit-ai/assistant-transcript-explorer-client-element/src/AssistantTranscriptExplorerClientElement.vue apps/jskit-value-app/src/components/AssistantTranscriptExplorerClientElement.ejected.vue
```

## Support policy

Maintained by Shared UI Guild. Contract-breaking prop/event/slot changes require migration notes and coordinated updates.

## Versioning policy

1. Contract-safe additions are minor/patch updates.
2. Breaking interface changes require migration guidance.

## Migration notes

Initial app migration targets:

1. `apps/jskit-value-app/src/views/workspace-transcripts/WorkspaceTranscriptsView.vue`
2. `apps/jskit-value-app/src/views/console/ConsoleAiTranscriptsView.vue`
