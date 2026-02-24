# `@jskit-ai/assistant-client-element`

Shared client element that owns reusable assistant conversation UI structure.

## What This Package Owns

1. Conversation message panel presentation.
2. Composer presentation and local UX behavior.
3. Conversation history panel presentation.
4. Tool timeline panel presentation.
5. Mobile conversation picker presentation.

## What Stays App-Local

1. Runtime wiring via `useAssistantView()`.
2. Workspace/auth surface policy.
3. API and streaming policy configuration.

## Required Props

1. `meta`
2. `state`
3. `actions`

## Optional Props

1. `viewer` (display name/avatar)
2. `copy`
3. `variant` (`layout`, `surface`, `density`, `tone`)
4. `features`
5. `ui`

## Events

1. `action:started`
2. `action:succeeded`
3. `action:failed`
4. `interaction`
5. `conversation:start`
6. `conversation:select`
7. `message:send`
8. `stream:cancel`

## Slots

1. `history-header-extra`
2. `tools-header-extra`
3. `composer-extra`
4. `empty-state`
5. `footer-extra`

## Variants

1. `layout`: `compact | comfortable`
2. `surface`: `plain | carded`
3. `density`: `compact | comfortable`
4. `tone`: `neutral | emphasized`

## Customization

1. Use `copy` to override headings/buttons and empty-state text.
2. Use `features` to toggle history/tools/mobile picker/composer action regions.
3. Use `viewer` to inject app-owned identity display.
4. Use slots for structural augmentation in history/tools/composer/empty-state areas.

## Eject

Raw source export:

- `@jskit-ai/assistant-client-element/source/AssistantClientElement.vue`

Example:

```bash
cp node_modules/@jskit-ai/assistant-client-element/src/AssistantClientElement.vue apps/jskit-value-app/src/components/AssistantClientElement.ejected.vue
```

## Support policy

Maintained by Shared UI Guild. Breaking prop/event/slot contract changes require migration notes and coordinated consumer updates.

## Versioning policy

1. Contract-safe additions are minor/patch updates.
2. Breaking interface changes require migration guidance.

## Migration notes

Initial app migration target: `apps/jskit-value-app/src/views/assistant/AssistantView.vue`.
