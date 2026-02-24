# `@jskit-ai/members-admin-client-element`

Shared client element for members and invites administration across workspace and console scopes.

## What This Package Owns

1. Invite form card and status alerts.
2. Members list with role selector.
3. Pending invites list with revoke actions.

## What Stays App-Local

1. Query/mutation logic and policy checks in composables.
2. Auth/runtime/store wiring.
3. API calls and access-control behavior.

## Required Props

1. `mode` (`workspace | console`)
2. `forms`
3. `options`
4. `collections`
5. `permissions`
6. `feedback`
7. `status`
8. `actions`

## Optional Props

1. `copy`
2. `variant` (`layout`, `surface`, `density`, `tone`)
3. `ui`

## Events

1. `action:started`
2. `action:succeeded`
3. `action:failed`
4. `interaction`
5. `invite:submit`
6. `invite:revoke`
7. `member:role-update`

## Slots

1. `invite-form-extra`
2. `members-list-extra`
3. `invites-list-extra`
4. `footer-extra`

## Variants

1. `layout`: `compact | comfortable`
2. `surface`: `plain | carded`
3. `density`: `compact | comfortable`
4. `tone`: `neutral | emphasized`

## Customization

1. Use `mode` to switch workspace vs console copy/behavior.
2. Use `copy` for labels, section text, and permission messaging.
3. Use slots to extend each major region without forking.
4. Use `ui.classes` and `ui.testIds` for host styling/testing hooks.

## Eject

Raw source export:

- `@jskit-ai/members-admin-client-element/source/MembersAdminClientElement.vue`

Example:

```bash
cp node_modules/@jskit-ai/members-admin-client-element/src/MembersAdminClientElement.vue apps/jskit-value-app/src/components/MembersAdminClientElement.ejected.vue
```

## Support policy

Maintained by Shared UI Guild. Contract-breaking prop/event/slot changes require migration notes and coordinated updates.

## Versioning policy

1. Contract-safe additions are minor/patch updates.
2. Breaking interface changes require migration guidance.

## Migration notes

Initial app migration targets:

1. `apps/jskit-value-app/src/views/workspace-admin/WorkspaceMembersView.vue`
2. `apps/jskit-value-app/src/views/console/ConsoleMembersView.vue`
