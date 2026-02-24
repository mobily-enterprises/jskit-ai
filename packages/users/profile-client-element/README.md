# `@jskit-ai/profile-client-element`

Shared client element that owns reusable account-profile form presentation.

## What This Package Owns

1. Profile avatar/preview region presentation.
2. Profile form field layout.
3. Submit and feedback panel presentation.

## What Stays App-Local

1. Profile state/actions via `useSettingsProfileForm()`.
2. Auth/session and uploader policy wiring.
3. Settings route orchestration.

## Required Props

1. `state`
2. `actions`

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
5. `profile:submit`
6. `avatar:replace`
7. `avatar:remove`

## Slots

1. `avatar-actions-extra`
2. `form-before`
3. `form-after`
4. `footer-extra`

## Variants

1. `layout`: `compact | comfortable`
2. `surface`: `plain | carded`
3. `density`: `compact | comfortable`
4. `tone`: `neutral | emphasized`

## Customization

1. Use `copy` to override all labels/help text/button text.
2. Use `features` for optional section toggles (`header`, `removeAvatar`).
3. Use slots for adding host UI before/after the form and avatar action row.
4. Use `ui.classes` and `ui.testIds` for host styling/test targeting.

## Eject

Raw source export:

- `@jskit-ai/profile-client-element/source/ProfileClientElement.vue`

Example:

```bash
cp node_modules/@jskit-ai/profile-client-element/src/ProfileClientElement.vue apps/jskit-value-app/src/components/ProfileClientElement.ejected.vue
```

## Support policy

Maintained by Shared UI Guild. Breaking prop/event/slot contract changes require migration notes and coordinated consumer updates.

## Versioning policy

1. Contract-safe additions are minor/patch updates.
2. Breaking interface changes require migration guidance.

## Migration notes

Initial app migration target: `apps/jskit-value-app/src/views/settings/profile/SettingsProfileForm.vue`.
