# `@jskit-ai/chat-client-element`

Shared client element that owns reusable chat UI structure while app runtime/policy remains app-local.

## What This Package Owns

1. Chat status alerts shell.
2. Thread tools row and message list presentation.
3. Composer shell and attachment list presentation.
4. DM dialog presentation.

## What Stays App-Local

1. Runtime wiring via `useChatView()`.
2. Auth/workspace policy and permission checks.
3. API transport and realtime configuration.

## Required Props

1. `meta`
2. `state`
3. `helpers`
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
5. `dm:open`
6. `message:send`
7. `attachment:add`
8. `attachment:remove`

## Slots

1. `message-row-prefix`
2. `message-row-suffix`
3. `composer-prefix`
4. `composer-suffix`
5. `thread-tools-extra`
6. `empty-state`
7. `footer-extra`

## Variants

1. `layout`: `compact | comfortable`
2. `surface`: `plain | carded`
3. `density`: `compact | comfortable`
4. `tone`: `neutral | emphasized`

## Customization

1. Use `copy` to override labels/placeholders.
2. Use `features` to toggle optional sections (`dmDialog`, `typingIndicator`, `attachmentPicker`).
3. Use `ui.classes` and `ui.testIds` for host-level styling/testing hooks.
4. Use slots for structural extensions around message rows/composer/tools.

## Eject

Raw source export:

- `@jskit-ai/chat-client-element/source/ChatClientElement.vue`

Example:

```bash
cp node_modules/@jskit-ai/chat-client-element/src/ChatClientElement.vue apps/jskit-value-app/src/components/ChatClientElement.ejected.vue
```

## Support policy

Maintained by Shared UI Guild. Breaking prop/event/slot contract changes require migration notes and coordinated consumer updates.

## Versioning policy

1. Contract-safe additions are minor/patch updates.
2. Breaking interface changes require migration guidance.

## Migration notes

Initial app migration target: `apps/jskit-value-app/src/views/chat/ChatView.vue`.
