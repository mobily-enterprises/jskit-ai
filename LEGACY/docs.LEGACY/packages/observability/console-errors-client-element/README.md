# `@jskit-ai/console-errors-client-element`

Shared client elements for console browser/server error list and detail views.

## What This Package Owns

1. Browser/server error list surface with table, simulation action, and pagination.
2. Browser/server error detail surface with metadata/message/stack rendering.

## What Stays App-Local

1. Runtime/composable wiring and permissions.
2. API calls and error simulation behavior.
3. Route navigation behavior.

## Exports

1. `ConsoleErrorListClientElement`
2. `ConsoleErrorDetailClientElement`

## Required Props

1. `mode` (`browser | server`)
2. `meta`
3. `state`
4. `actions`

## Optional Props

1. `copy`
2. `variant` (`layout`, `surface`, `density`, `tone`)
3. `ui`

## Events

1. `action:started`
2. `action:succeeded`
3. `action:failed`
4. `interaction`
5. `simulate:trigger` (list)
6. `error:view` (list)

## Variants

1. `layout`: `compact | comfortable`
2. `surface`: `plain | carded`
3. `density`: `compact | comfortable`
4. `tone`: `neutral | emphasized`

## Customization

1. Use `mode` to switch browser/server rendering.
2. Use `copy` to override labels/headings/messages.
3. Use `ui.classes` and `ui.testIds` for host style/testing hooks.

## Eject

Raw source exports:

1. `@jskit-ai/console-errors-client-element/source/ConsoleErrorListClientElement.vue`
2. `@jskit-ai/console-errors-client-element/source/ConsoleErrorDetailClientElement.vue`

Example:

```bash
cp node_modules/@jskit-ai/console-errors-client-element/src/ConsoleErrorListClientElement.vue apps/jskit-value-app/src/components/ConsoleErrorListClientElement.ejected.vue
```

## Support policy

Maintained by Shared UI Guild. Contract-breaking prop/event changes require migration notes and coordinated updates.

## Versioning policy

1. Contract-safe additions are minor/patch updates.
2. Breaking interface changes require migration guidance.

## Migration notes

Initial app migration targets:

1. `apps/jskit-value-app/src/views/console/ConsoleBrowserErrorsView.vue`
2. `apps/jskit-value-app/src/views/console/ConsoleServerErrorsView.vue`
3. `apps/jskit-value-app/src/views/console/ConsoleBrowserErrorDetailView.vue`
4. `apps/jskit-value-app/src/views/console/ConsoleServerErrorDetailView.vue`
