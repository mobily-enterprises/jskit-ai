# Changelog

## Unreleased

- A select or autocomplete in the configuration form scrolls to and focuses the option typed into it even when the app sets `VMenu` defaults. Each panel's fields now take the app's root Vuetify defaults instead of the panel's, which Vuetify 4.2.1 to 4.3.2 gave new defaults on every edit; under any `VMenu` default that made the menu lose the match ([vuetifyjs/vuetify#23366](https://github.com/vuetifyjs/vuetify/issues/23366)). Upgrading: defaults an app scopes around the form with its own `v-defaults-provider` no longer reach its fields; set them in the app's Vuetify defaults instead.

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".
- Configuration fields translate provider texts and field errors.

### New message keys (37)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.connectors.configurationFields.accountMode.label`
- `jskit.connectors.configurationFields.accountModes.assistant`
- `jskit.connectors.configurationFields.accountModes.perUser`
- `jskit.connectors.configurationFields.accountModes.shared`
- `jskit.connectors.configurationFields.apiKeyReference.hint`
- `jskit.connectors.configurationFields.apiKeyReference.label`
- `jskit.connectors.configurationFields.ariaLabel`
- `jskit.connectors.configurationFields.assistant.defaultPermission.hint`
- `jskit.connectors.configurationFields.assistant.defaultPermission.label`
- `jskit.connectors.configurationFields.assistant.enabled.label`
- `jskit.connectors.configurationFields.assistant.hint`
- `jskit.connectors.configurationFields.assistantPermissions.always`
- `jskit.connectors.configurationFields.assistantPermissions.ask`
- `jskit.connectors.configurationFields.assistantPermissions.never`
- `jskit.connectors.configurationFields.authentication.label`
- `jskit.connectors.configurationFields.authenticationMethods.apiKey`
- `jskit.connectors.configurationFields.authenticationMethods.none`
- `jskit.connectors.configurationFields.authenticationMethods.oauth2`
- `jskit.connectors.configurationFields.authenticationMethods.serviceAccount`
- `jskit.connectors.configurationFields.callbackUrl.label`
- `jskit.connectors.configurationFields.callbackUrlReference.hint`
- `jskit.connectors.configurationFields.callbackUrlReference.label`
- `jskit.connectors.configurationFields.clientId.label`
- `jskit.connectors.configurationFields.clientSecretReference.hint`
- `jskit.connectors.configurationFields.clientSecretReference.label`
- `jskit.connectors.configurationFields.displayName.label`
- `jskit.connectors.configurationFields.grantType.label`
- `jskit.connectors.configurationFields.grantTypes.authorizationCode`
- `jskit.connectors.configurationFields.grantTypes.clientCredentials`
- `jskit.connectors.configurationFields.panels.assistant`
- `jskit.connectors.configurationFields.panels.credentials`
- `jskit.connectors.configurationFields.panels.details`
- `jskit.connectors.configurationFields.panels.permissions`
- `jskit.connectors.configurationFields.permissions.hint`
- `jskit.connectors.configurationFields.registration.label`
- `jskit.connectors.configurationFields.serviceAccountReference.hint`
- `jskit.connectors.configurationFields.serviceAccountReference.label`

</details>
