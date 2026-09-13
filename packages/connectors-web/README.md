# Integration configuration fields

`IntegrationConfigurationFields` is a controlled Vue/Vuetify component imported
from `@jskit-ai/connectors-web/client`. It edits the same configuration accepted
by `@jskit-ai/connectors-core/shared/configuration`.

```vue
<IntegrationConfigurationFields
  v-model="configuration"
  integration-id="calendar"
  :provider="googleCalendarDefinition"
  :field-errors="fieldErrors"
  :disabled="saving"
  :callback-url="resolvedCallbackUrl"
/>
```

The parent owns loading, saving, optimistic concurrency and navigation, using
its normal JSKIT `useAddEdit()`/command/resource flow. This component makes no
HTTP requests and creates no second source of connection state. Model updates
preserve other integration slots, registrations and extension values.

Provider `settingsFields` metadata supplies labelled select controls when `items`
are provided and text controls otherwise, with optional hints and placeholders.
Defaults and applicable fields come from
`getProviderSettingsSchema(provider, settings).getFieldDefinitions()`, which also
supports schemas containing custom validators. A provider may select a schema
from its current settings; changing Redshift deployment type removes fields
that belong to the other type and shows the new required inputs. The CLI rejects
mixed fields through that same schema. Clearing optional text omits it
from the serialized configuration. The parent
validates with the same provider definitions and saves the returned normalized
configuration, so forms and CLI edits apply the same defaults and errors.
For providers with a separately named credential, `apiKeyReferenceLabel`
customizes the primary reference field's label. Twilio uses **API key secret
reference** alongside the Account SID and API Key SID settings; the default
label for other providers remains **API key reference**.
`apiKeyReferenceHint` customizes the reference hint. PostHog uses it to explain
that its project token is publishable and cannot read private analytics. The
saved value still follows the same reference format as CLI configuration.

Providers with multiple `authenticationMethods` get an Authentication selector;
`authenticationLabels` and `authenticationHint` supply provider-specific copy.
`settingsFields[].authenticationMethods` controls which fields apply. Changing
mode removes the old authentication references and settings that no longer
apply. Selecting OAuth creates a new project-owned registration with editable
client fields and Env references, without replacing existing registrations. The
App registration selector can then choose an existing registration instead.
With `apiKeySecretOptional`, clearing the primary reference omits it
instead of saving an empty string. ClickHouse uses this for an empty database
password. Its separate `none` mode hides credential fields entirely. These
choices use the same shared validation as a hand-edited configuration file.

`scopesForSettings(settings)` limits the displayed permission choices. Changing
a setting retains selected scopes that still apply and removes incompatible
ones, then selects any newly required scopes. Snowflake uses this for its
optional role; clearing the role restores its required default-role scope.
Optional choices stay unselected. Slack uses this for its user and bot identities. The shared parser rejects
an incompatible permission in imported JSON; it does not silently accept a
permission that the form cannot display. Changing back does not restore removed
permissions.

Scope entries with `required: true` render as disabled checkboxes. The parent
initializes these through the provider's recommended defaults, and shared
configuration validation rejects missing required permissions. LinkedIn requires
OpenID and profile while leaving email and publishing optional.

Providers declaring multiple `oauthGrantTypes` get an **OAuth flow** selector.
`oauthGrantHint` explains the credential choice. Switching to client credentials
removes the callback field and its saved reference, filters incompatible scopes,
and changes a personal account mode to the provider's first non-personal mode.
The client authentication method follows the provider's grant-specific methods.
Switching back requires entering the callback reference again and explicitly
selecting the needed permissions. The registration's client ID and secret
reference remain editable; use the credentials belonging to the chosen flow.
`getProviderScopes` supplies the same choices used by CLI validation.
Other integrations sharing that registration are preserved; validation reports
any newly incompatible configuration instead of silently rewriting those slots.

Panels provide details, registration credentials and permissions. The default
credential field edits a **reference**, suitable for developer tooling. A host
can use the `credential` slot to provide its secret-entry control; it must save
the secret through its secret service and keep only a reference in the model.
The slot receives `reference` and `disabled`. Registrations belong to the
application and use `source: "own"`. `access` provides a place for the host's
existing permissions editor.

The component handles OAuth configurations with pre-existing slots and
registrations, API-key configurations and declared no-credential modes. The
host owns catalogue search, slot creation and persistent file editing; public
Vibe64 supplies those through its source editor. Account connection and consent
controls are still pending. The browser fixture is a focused round-trip test,
not a complete application.

Run `npm exec --no -- playwright test --config
packages/connectors-web/test/playwright.config.js` from the JSKIT checkout.
Tests cover compact, medium and expanded layouts. The config respects managed
runner base URLs and temporary authentication state when supplied.

Definitions can set `permissionsHint` when permissions represent local operation
limits rather than an OAuth consent grant, as for S3 read/write choices. These
controls and statically declared permission choices remain visible in token
mode. Dynamically discovered OAuth permission choices appear only for OAuth or
service-account authentication; retained discovery metadata does not display
OAuth consent choices in API-key mode.

`accountModesForSettings(settings)` restricts account choices using the same
helper as configuration validation. Switching a credential-scoped setting to
OAuth creates a fresh registration with that setting's supported client
authentication method. This keeps Notion REST and hosted MCP credentials
separate; previous registrations remain available for their original slots.

Switching away from OAuth discards an unused own-registration draft whose Client ID is still empty. Registrations with a Client ID or another integration referencing them are preserved. This lets a newly added OAuth provider switch to an API key without an invisible empty registration blocking configuration validation.
