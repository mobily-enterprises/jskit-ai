# Destination navigation

Use this pattern for JSKIT routing, Back/Up behavior, exact list return state, route machinery, and adaptive primary navigation.

- Enable the one kernel navigation runtime with the exact Vue Router history and pass it through bootstrap.
- Every committed route declares `meta.jskit.navigation`; there is no implicit classification.
- Use `destination` plus a stable `destinationKey` for meaningful work screens and peer record views.
- Use `preserve` plus a stable `machineryKey` for edit/create/short wizard machinery.
- Use `boundary` plus `persistence.mode: "none"` for sensitive ownerless flows.
- Use `JskitDestinationLink` or real RouterLinks. Never build an app-local return-query stack.
- Keep URL state canonical. Register versioned contributors only for small serializable structure, stable item anchor/offset, and focus keys.
- The shell owns one leading Back/menu/none control and renders semantic primary navigation through Vuetify bottom navigation, rail, and drawer variants.
- Unsaved forms use the shared blocker and shell Vuetify alert dialog, not a special Back handler.
- Validate principal, surface, workspace, and tenant scope before restoration.

Human guide: `packages/agent-docs/site/guide/navigation/destination-stack.md`.

