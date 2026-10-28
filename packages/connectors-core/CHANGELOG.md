# Changelog

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".
- `ConnectorError` carries `messageCode`/`messageParams`; `MESSAGE_KEY_SOURCE` links an English provider definition to its keyed original.
- `createEnglishProviderTexts(catalog)` renders a keyed provider definition to its English.

### New message keys (80)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.connectors.configuration.accountModeUnsupported`
- `jskit.connectors.configuration.apiKeyRegistration`
- `jskit.connectors.configuration.assistantActionUndeclared`
- `jskit.connectors.configuration.clientAuthenticationUnsupported`
- `jskit.connectors.configuration.clientId`
- `jskit.connectors.configuration.confidentialClientRequired`
- `jskit.connectors.configuration.credentialModeUnsupported`
- `jskit.connectors.configuration.duplicateScope`
- `jskit.connectors.configuration.invalid`
- `jskit.connectors.configuration.invalidJson`
- `jskit.connectors.configuration.noCredentials`
- `jskit.connectors.configuration.oauthFlowUnsupported`
- `jskit.connectors.configuration.otherCredentialModeField`
- `jskit.connectors.configuration.otherCredentialModeSetting`
- `jskit.connectors.configuration.providerSettings`
- `jskit.connectors.configuration.providerUnregistered`
- `jskit.connectors.configuration.refreshTokenClientCredentials`
- `jskit.connectors.configuration.refreshTokenOAuthOnly`
- `jskit.connectors.configuration.refreshTokenSharedOnly`
- `jskit.connectors.configuration.registrationSecret`
- `jskit.connectors.configuration.registrationUndefined`
- `jskit.connectors.configuration.requiredScopes`
- `jskit.connectors.configuration.schemaVersionUnsupported`
- `jskit.connectors.configuration.scopeRequired`
- `jskit.connectors.configuration.scopeUnsupported`
- `jskit.connectors.configuration.serviceAccountPerUser`
- `jskit.connectors.configuration.serviceAccountRegistration`
- `jskit.connectors.configuration.stableName`
- `jskit.connectors.configuration.valueRequired`
- `jskit.connectors.connection.ambiguousPermissionGrant`
- `jskit.connectors.connection.apiKeyBindingMissingInvalid`
- `jskit.connectors.connection.assistantActionDisabled`
- `jskit.connectors.connection.authorizationAttemptInvalidExpired`
- `jskit.connectors.connection.authorizationCallbackInvalid`
- `jskit.connectors.connection.callbackDoesNotMatchRegistration`
- `jskit.connectors.connection.callbackUrlDoesNotMeet`
- `jskit.connectors.connection.checkOperationInputValues`
- `jskit.connectors.connection.configureHttpsCallbackUrlLocal`
- `jskit.connectors.connection.connectAccountAgain`
- `jskit.connectors.connection.connectAgainPermissionRequiredOperation`
- `jskit.connectors.connection.connectAgainPermissionRequiredVerification`
- `jskit.connectors.connection.connectionNotAllowed`
- `jskit.connectors.connection.envRefreshTokenRejected`
- `jskit.connectors.connection.envSeeded`
- `jskit.connectors.connection.integrationNotConfigured`
- `jskit.connectors.connection.operationCancelled`
- `jskit.connectors.connection.operationRequiresDifferentMethod`
- `jskit.connectors.connection.operationRequiresPermissionAbsentApplication`
- `jskit.connectors.connection.providerClientIdNotConfigured`
- `jskit.connectors.connection.providerDeniedOperation`
- `jskit.connectors.connection.providerDoesNotDeclareAssistant`
- `jskit.connectors.connection.providerDoesNotImplementService`
- `jskit.connectors.connection.providerInvalidCredentialPath`
- `jskit.connectors.connection.providerNonPkceFlowRequires`
- `jskit.connectors.connection.providerOperationInvalidDestination`
- `jskit.connectors.connection.providerOperationNotAvailable`
- `jskit.connectors.connection.providerRequestFailedTryAgain`
- `jskit.connectors.connection.providerRequestLimitReached`
- `jskit.connectors.connection.providerRequiresJsonRequestBody`
- `jskit.connectors.connection.providerReturnedInvalidAccountLabel`
- `jskit.connectors.connection.providerReturnedInvalidPermissionGrant`
- `jskit.connectors.connection.providerReturnedInvalidServiceAccount`
- `jskit.connectors.connection.providerReturnedUnexpectedResponse`
- `jskit.connectors.connection.refreshTokenBindingMissingInvalid`
- `jskit.connectors.connection.requiredEnvironmentBindingMissing`
- `jskit.connectors.connection.requiredRegistrationBindingMissing`
- `jskit.connectors.connection.runtimeDoesNotYetSupport`
- `jskit.connectors.connection.selectClientCredentialsConnectService`
- `jskit.connectors.connection.selectMatchingCredentialModeVerify`
- `jskit.connectors.connection.selectServiceAccountCredentialsVerify`
- `jskit.connectors.connection.serviceAccountCredentialBindingMissing`
- `jskit.connectors.connection.serviceAccountsConnectWithoutBrowser`
- `jskit.connectors.connection.serviceAccountsDoNotUse`
- `jskit.connectors.connection.verificationScopeAbsent`
- `jskit.errors.connector_approval_required`
- `jskit.errors.connector_consent_denied`
- `jskit.errors.connector_credentials_unavailable`
- `jskit.errors.connector_provider_timeout`
- `jskit.errors.connector_storage_invalid`
- `jskit.errors.integration_configuration_invalid`

</details>

### Codes (80)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `connectors.configuration.accountModeUnsupported` | This provider does not support this account mode. |
| `connectors.configuration.apiKeyRegistration` | API keys do not use an OAuth registration. |
| `connectors.configuration.assistantActionUndeclared` | This provider does not declare this assistant action. |
| `connectors.configuration.clientAuthenticationUnsupported` | This provider does not support this client authentication method. |
| `connectors.configuration.clientId` | Check this provider's client identifier. |
| `connectors.configuration.confidentialClientRequired` | Client credentials require a confidential client. |
| `connectors.configuration.credentialModeUnsupported` | This provider configuration does not support this credential mode. |
| `connectors.configuration.duplicateScope` | Select each permission only once. |
| `connectors.configuration.invalid` | Invalid configuration. |
| `connectors.configuration.invalidJson` | Enter valid JSON. |
| `connectors.configuration.noCredentials` | This mode does not use credentials. |
| `connectors.configuration.oauthFlowUnsupported` | This provider does not support this OAuth flow. |
| `connectors.configuration.otherCredentialModeField` | This field belongs to another credential mode. |
| `connectors.configuration.otherCredentialModeSetting` | This setting belongs to another credential mode. |
| `connectors.configuration.providerSettings` | Check this provider's settings. |
| `connectors.configuration.providerUnregistered` | Install and register this provider before using it. |
| `connectors.configuration.refreshTokenClientCredentials` | Client credentials do not use a refresh token. |
| `connectors.configuration.refreshTokenOAuthOnly` | Only an OAuth connection can start from a refresh token. |
| `connectors.configuration.refreshTokenSharedOnly` | Only a shared connection can start from a refresh token in Env. |
| `connectors.configuration.registrationSecret` | Use the registration's secret reference. |
| `connectors.configuration.registrationUndefined` | Select a registration defined in this file. |
| `connectors.configuration.requiredScopes` | Include this provider's required permissions. |
| `connectors.configuration.schemaVersionUnsupported` | Use numeric schemaVersion 1; other versions require an explicit migration. |
| `connectors.configuration.scopeRequired` | Select at least one permission. |
| `connectors.configuration.scopeUnsupported` | A selected permission is not supported by this provider configuration. |
| `connectors.configuration.serviceAccountPerUser` | A service account cannot connect as each app user. |
| `connectors.configuration.serviceAccountRegistration` | Service-account credentials do not use a browser OAuth registration. |
| `connectors.configuration.stableName` | Use a stable lowercase name containing letters, digits and hyphens. |
| `connectors.configuration.valueRequired` | This value is required. |
| `connectors.connection.ambiguousPermissionGrant` | The provider did not return an unambiguous permission grant. |
| `connectors.connection.apiKeyBindingMissingInvalid` | The API key binding is missing or invalid. |
| `connectors.connection.assistantActionDisabled` | This assistant action is disabled. |
| `connectors.connection.authorizationAttemptInvalidExpired` | The authorization attempt is invalid or has expired. |
| `connectors.connection.authorizationCallbackInvalid` | The authorization callback is invalid. |
| `connectors.connection.callbackDoesNotMatchRegistration` | The callback does not match this registration. |
| `connectors.connection.callbackUrlDoesNotMeet` | The callback URL does not meet this provider's requirements. |
| `connectors.connection.checkOperationInputValues` | Check the operation's input values. |
| `connectors.connection.configureHttpsCallbackUrlLocal` | Configure an HTTPS callback URL, or a local development callback. |
| `connectors.connection.connectAccountAgain` | Connect this account again. |
| `connectors.connection.connectAgainPermissionRequiredOperation` | Connect again with the permission required for this operation. |
| `connectors.connection.connectAgainPermissionRequiredVerification` | Connect again with the permission required for verification. |
| `connectors.connection.connectionNotAllowed` | You cannot use this connection. |
| `connectors.connection.envRefreshTokenRejected` | The refresh token in Env no longer works; replace that Env value. |
| `connectors.connection.envSeeded` | This connection comes from an Env value; unlink or replace that value instead. |
| `connectors.connection.integrationNotConfigured` | This integration is not configured. |
| `connectors.connection.operationCancelled` | The operation was cancelled. |
| `connectors.connection.operationRequiresDifferentMethod` | This operation requires a different connection method. |
| `connectors.connection.operationRequiresPermissionAbsentApplication` | This operation requires a permission absent from the application's configuration. |
| `connectors.connection.providerClientIdNotConfigured` | The provider client ID is not configured. |
| `connectors.connection.providerDeniedOperation` | The provider denied this operation. |
| `connectors.connection.providerDoesNotDeclareAssistant` | This provider does not declare this assistant action. |
| `connectors.connection.providerDoesNotImplementService` | This provider does not implement service-account authorization. |
| `connectors.connection.providerInvalidCredentialPath` | This provider has an invalid credential path. |
| `connectors.connection.providerNonPkceFlowRequires` | This provider's non-PKCE flow requires a confidential client. |
| `connectors.connection.providerOperationInvalidDestination` | The provider operation has an invalid destination. |
| `connectors.connection.providerOperationNotAvailable` | This provider operation is not available. |
| `connectors.connection.providerRequestFailedTryAgain` | The provider request failed. Try again. |
| `connectors.connection.providerRequestLimitReached` | The provider's request limit was reached. |
| `connectors.connection.providerRequiresJsonRequestBody` | This provider requires a JSON request body. |
| `connectors.connection.providerReturnedInvalidAccountLabel` | The provider returned an invalid account label. |
| `connectors.connection.providerReturnedInvalidPermissionGrant` | The provider returned an invalid permission grant. |
| `connectors.connection.providerReturnedInvalidServiceAccount` | The provider returned an invalid service-account token. |
| `connectors.connection.providerReturnedUnexpectedResponse` | The provider returned an unexpected response. |
| `connectors.connection.refreshTokenBindingMissingInvalid` | The refresh token binding is missing or invalid. |
| `connectors.connection.requiredEnvironmentBindingMissing` | A required environment binding is missing. |
| `connectors.connection.requiredRegistrationBindingMissing` | A required registration binding is missing. |
| `connectors.connection.runtimeDoesNotYetSupport` | This runtime does not yet support the selected credential mode. |
| `connectors.connection.selectClientCredentialsConnectService` | Select client credentials to connect a service account. |
| `connectors.connection.selectMatchingCredentialModeVerify` | Select the matching credential mode to verify this connection. |
| `connectors.connection.selectServiceAccountCredentialsVerify` | Select service-account credentials to verify this connection. |
| `connectors.connection.serviceAccountCredentialBindingMissing` | The service-account credential binding is missing or invalid. |
| `connectors.connection.serviceAccountsConnectWithoutBrowser` | Service accounts connect without browser consent. |
| `connectors.connection.serviceAccountsDoNotUse` | Service accounts do not use an authorization callback. |
| `connectors.connection.verificationScopeAbsent` | Connection verification requires a permission absent from the application's configuration. |
| `connector_approval_required` | Approve this assistant action before continuing. |
| `connector_consent_denied` | Account access was declined. |
| `connector_credentials_unavailable` | Stored credentials could not be opened. |
| `connector_provider_timeout` | The provider request timed out. Try again. |
| `connector_storage_invalid` | Connection state could not be read safely. |
| `integration_configuration_invalid` | Integration configuration is invalid. |
