import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";

const name = { type: "string", required: true, minLength: 1, maxLength: 200 };
const secretReference = {
  ...name,
  pattern: "^(?!https?:)[a-z][a-z0-9-]*:[^\\s]+$"
};
const authenticationSchema = createSchema({
  method: { ...name, enum: ["oauth2", "api-key", "service-account", "none"] },
  registrationRef: { ...name, required: false },
  secretRef: { ...secretReference, required: false },
  refreshTokenRef: { ...secretReference, required: false }
});
const assistantPermission = { type: "string", enum: ["ask", "always", "never"] };
const assistantPolicySchema = createSchema({
  enabled: { type: "boolean", strictBoolean: true, defaultTo: true },
  defaultPermission: { ...assistantPermission, defaultTo: "ask" },
  actions: { type: "object", values: assistantPermission, defaultTo: {} }
});
const integrationSchema = createSchema({
  provider: name,
  displayName: { ...name, required: false },
  accountMode: { ...name, enum: ["shared", "per-user", "assistant"] },
  scopes: { type: "array", items: { ...name, maxLength: 2048 }, required: true },
  authentication: { type: "object", schema: authenticationSchema, required: true },
  settings: { type: "object", additionalProperties: true, required: false },
  assistantPolicy: { type: "object", schema: assistantPolicySchema, required: false },
  extensions: { type: "object", additionalProperties: true, required: false }
});
const registrationSchema = createSchema({
  source: { ...name, enum: ["own"] },
  grantType: { ...name, enum: ["authorization_code", "client_credentials"], required: false },
  clientId: { ...name, maxLength: 2048, required: false },
  clientSecretRef: { ...secretReference, required: false },
  tokenEndpointAuthMethod: { ...name, enum: ["client_secret_post", "client_secret_basic", "none"], required: false },
  callbackUrlRef: { ...secretReference, required: false }
});

const integrationsSchema = createSchema({
  schemaVersion: { type: "integer", enum: [1], required: true },
  integrations: { type: "object", values: integrationSchema, required: true },
  registrations: { type: "object", values: registrationSchema, required: true },
  extensions: { type: "object", additionalProperties: true, required: false }
});

// A field error is English text or { code, params, message }, as for the kernel's
// createValidationError: fieldErrors keeps the English, fieldErrorCodes the codes.
class IntegrationConfigurationError extends Error {
  constructor(fieldErrors, fieldErrorCodes = {}) {
    super("Integration configuration is invalid.");
    this.name = "IntegrationConfigurationError";
    this.code = "integration_configuration_invalid";
    this.statusCode = 422;
    this.fieldErrors = {};
    this.fieldErrorCodes = { ...fieldErrorCodes };
    for (const [field, entry] of Object.entries(fieldErrors)) {
      this.fieldErrors[field] = typeof entry === "string" ? entry : entry.message;
      if (entry?.code) this.fieldErrorCodes[field] = { code: entry.code, params: { ...entry.params } };
    }
  }
}

// Each configuration field error's English, rendered from "jskit.<code>".
const FIELD_ERRORS = Object.freeze({
  schemaVersion: { code: "connectors.configuration.schemaVersionUnsupported", message: "Use numeric schemaVersion 1; other versions require an explicit migration." },
  invalid: { code: "connectors.configuration.invalid", message: "Invalid configuration." },
  invalidJson: { code: "connectors.configuration.invalidJson", message: "Enter valid JSON." },
  required: { code: "connectors.configuration.valueRequired", message: "This value is required." },
  stableName: { code: "connectors.configuration.stableName", message: "Use a stable lowercase name containing letters, digits and hyphens." },
  otherCredentialMode: { code: "connectors.configuration.otherCredentialModeField", message: "This field belongs to another credential mode." },
  confidentialClient: { code: "connectors.configuration.confidentialClientRequired", message: "Client credentials require a confidential client." },
  refreshTokenOAuthOnly: { code: "connectors.configuration.refreshTokenOAuthOnly", message: "Only an OAuth connection can start from a refresh token." },
  registrationUndefined: { code: "connectors.configuration.registrationUndefined", message: "Select a registration defined in this file." },
  registrationSecret: { code: "connectors.configuration.registrationSecret", message: "Use the registration's secret reference." },
  refreshTokenSharedOnly: { code: "connectors.configuration.refreshTokenSharedOnly", message: "Only a shared connection can start from a refresh token in Env." },
  refreshTokenClientCredentials: { code: "connectors.configuration.refreshTokenClientCredentials", message: "Client credentials do not use a refresh token." },
  serviceAccountPerUser: { code: "connectors.configuration.serviceAccountPerUser", message: "A service account cannot connect as each app user." },
  apiKeyRegistration: { code: "connectors.configuration.apiKeyRegistration", message: "API keys do not use an OAuth registration." },
  serviceAccountRegistration: { code: "connectors.configuration.serviceAccountRegistration", message: "Service-account credentials do not use a browser OAuth registration." },
  noCredentials: { code: "connectors.configuration.noCredentials", message: "This mode does not use credentials." },
  duplicateScope: { code: "connectors.configuration.duplicateScope", message: "Select each permission only once." },
  providerUnregistered: { code: "connectors.configuration.providerUnregistered", message: "Install and register this provider before using it." },
  assistantActionUndeclared: { code: "connectors.configuration.assistantActionUndeclared", message: "This provider does not declare this assistant action." },
  providerSettings: { code: "connectors.configuration.providerSettings", message: "Check this provider's settings." },
  otherCredentialModeSetting: { code: "connectors.configuration.otherCredentialModeSetting", message: "This setting belongs to another credential mode." },
  accountModeUnsupported: { code: "connectors.configuration.accountModeUnsupported", message: "This provider does not support this account mode." },
  credentialModeUnsupported: { code: "connectors.configuration.credentialModeUnsupported", message: "This provider configuration does not support this credential mode." },
  oauthFlowUnsupported: { code: "connectors.configuration.oauthFlowUnsupported", message: "This provider does not support this OAuth flow." },
  clientAuthenticationUnsupported: { code: "connectors.configuration.clientAuthenticationUnsupported", message: "This provider does not support this client authentication method." },
  clientId: { code: "connectors.configuration.clientId", message: "Check this provider's client identifier." },
  requiredScopes: { code: "connectors.configuration.requiredScopes", message: "Include this provider's required permissions." },
  scopeUnsupported: { code: "connectors.configuration.scopeUnsupported", message: "A selected permission is not supported by this provider configuration." },
  scopeRequired: { code: "connectors.configuration.scopeRequired", message: "Select at least one permission." }
});

// A schema validation error's field errors with the codes the validator gave them.
function schemaFieldErrors(error, fallback, prefix = "") {
  const messages = {};
  const codes = {};
  for (const [field, message] of Object.entries(error.fieldErrors || fallback)) {
    messages[`${prefix}${field}`] = message;
    const coded = error.fieldErrorCodes?.[field];
    if (coded) codes[`${prefix}${field}`] = coded;
  }
  return { messages, codes };
}

// Registrations, attempts and stored connections omit these when they use the defaults.
const DEFAULT_GRANT_TYPE = "authorization_code";
const DEFAULT_TOKEN_ENDPOINT_AUTH_METHOD = "client_secret_post";
// A provider definition whose texts were rendered to English keeps its message-key
// original under this symbol, so a translating UI can render the keys instead.
const MESSAGE_KEY_SOURCE = Symbol.for("@jskit-ai/connectors-core.messageKeySource");

function registrationGrantType(record) {
  return record?.grantType || DEFAULT_GRANT_TYPE;
}

function registrationClientAuthentication(record) {
  return record?.tokenEndpointAuthMethod || DEFAULT_TOKEN_ENDPOINT_AUTH_METHOD;
}

function providerGrantTypes(provider) {
  return provider.oauthGrantTypes || [DEFAULT_GRANT_TYPE];
}

function getProviderSettingsSchema(provider, settings = {}) {
  return typeof provider.settingsSchema === "function" ? provider.settingsSchema(settings) : provider.settingsSchema;
}

function getProviderAuthenticationMethods(provider, settings = {}) {
  return provider.authenticationMethodsForSettings ? provider.authenticationMethodsForSettings(settings) : provider.authenticationMethods;
}

function getProviderAccountModes(provider, settings = {}) {
  return provider.accountModesForSettings ? provider.accountModesForSettings(settings) : provider.accountModes;
}

function getProviderScopes(provider, settings = {}, grantType = DEFAULT_GRANT_TYPE, authenticationMethod) {
  const scopes = provider.scopesForGrantType ? provider.scopesForGrantType(grantType, settings)
    : provider.scopesForSettings ? provider.scopesForSettings(settings) : provider.scopes;
  return authenticationMethod ? scopes.filter(scope => !scope.authenticationMethods || scope.authenticationMethods.includes(authenticationMethod)) : scopes;
}

function getProviderClientAuthenticationMethods(provider, grantType = DEFAULT_GRANT_TYPE, settings = {}) {
  const methods = provider.oauthClientAuthenticationMethods;
  return typeof methods === "function" ? methods(grantType, settings) : methods || [DEFAULT_TOKEN_ENDPOINT_AUTH_METHOD];
}

// Setup text precedence: settings-dependent, then per-authentication-method, then static.
function getProviderSetup(provider, settings = {}, authenticationMethod) {
  const setup = provider.setup || {};
  return {
    url: setup.urlForSettings?.(settings, authenticationMethod) || setup.urlByAuthentication?.[authenticationMethod] || setup.url,
    steps: setup.stepsForSettings?.(settings, authenticationMethod) || setup.stepsByAuthentication?.[authenticationMethod] || setup.steps
  };
}

function isProviderConfigurationOnly(provider, settings = {}) {
  return Boolean(provider.configurationOnly || provider.configurationOnlyForSettings?.(settings));
}

function validateIntegrationConfiguration(input, { providers = [], allowUnknownProviders = false } = {}) {
  if (input?.schemaVersion !== 1) {
    throw new IntegrationConfigurationError({ schemaVersion: FIELD_ERRORS.schemaVersion });
  }
  let config;
  try {
    config = validateSchemaPayload({ schema: integrationsSchema, mode: "replace" }, input);
  } catch (error) {
    const { messages, codes } = schemaFieldErrors(error, { configuration: FIELD_ERRORS.invalid });
    throw new IntegrationConfigurationError(messages, codes);
  }
  const fieldErrors = {};
  const fieldErrorCodes = {};
  const definitions = new Map(providers.map((provider) => [provider.id, provider]));
  const requireValue = (record, key, path) => {
    if (!record[key]) fieldErrors[`${path}.${key}`] = FIELD_ERRORS.required;
  };
  for (const field of ["integrations", "registrations"]) {
    for (const id of Object.keys(config[field])) {
      if (!/^[a-z][a-z0-9-]*$/u.test(id) || ["constructor", "prototype"].includes(id)) {
        fieldErrors[`${field}.${id}`] = FIELD_ERRORS.stableName;
      }
    }
  }
  for (const [id, registration] of Object.entries(config.registrations)) {
    const path = `registrations.${id}`;
    const clientCredentials = registration.grantType === "client_credentials";
    const required = ["clientId", ...(clientCredentials ? [] : ["callbackUrlRef"]), ...(registration.tokenEndpointAuthMethod === "none" ? [] : ["clientSecretRef"])];
    for (const key of required) requireValue(registration, key, path);
    const forbidden = [...(clientCredentials ? ["callbackUrlRef"] : []), ...(registration.tokenEndpointAuthMethod === "none" ? ["clientSecretRef"] : [])];
    for (const key of forbidden) {
      if (Object.hasOwn(registration, key)) fieldErrors[`${path}.${key}`] = FIELD_ERRORS.otherCredentialMode;
    }
    if (clientCredentials && registration.tokenEndpointAuthMethod === "none") {
      fieldErrors[`${path}.tokenEndpointAuthMethod`] = FIELD_ERRORS.confidentialClient;
    }
  }
  for (const [id, integration] of Object.entries(config.integrations)) {
    const path = `integrations.${id}`;
    const auth = integration.authentication;
    const provider = definitions.get(integration.provider);
    const registration = config.registrations[auth.registrationRef];
    const grantType = registrationGrantType(registration);
    if (auth.refreshTokenRef && auth.method !== "oauth2") {
      fieldErrors[`${path}.authentication.refreshTokenRef`] = FIELD_ERRORS.refreshTokenOAuthOnly;
    }
    if (auth.method === "oauth2") {
      if (!auth.registrationRef || !Object.hasOwn(config.registrations, auth.registrationRef)) {
        fieldErrors[`${path}.authentication.registrationRef`] = FIELD_ERRORS.registrationUndefined;
      }
      if (auth.secretRef) fieldErrors[`${path}.authentication.secretRef`] = FIELD_ERRORS.registrationSecret;
      if (auth.refreshTokenRef && integration.accountMode !== "shared") {
        fieldErrors[`${path}.authentication.refreshTokenRef`] = FIELD_ERRORS.refreshTokenSharedOnly;
      } else if (auth.refreshTokenRef && grantType !== "authorization_code") {
        fieldErrors[`${path}.authentication.refreshTokenRef`] = FIELD_ERRORS.refreshTokenClientCredentials;
      }
      if (grantType === "client_credentials" && integration.accountMode === "per-user") {
        fieldErrors[`${path}.accountMode`] = FIELD_ERRORS.serviceAccountPerUser;
      }
    } else if (auth.method === "api-key") {
      if (!provider?.apiKeySecretOptional) requireValue(auth, "secretRef", `${path}.authentication`);
      if (auth.registrationRef) fieldErrors[`${path}.authentication.registrationRef`] = FIELD_ERRORS.apiKeyRegistration;
    } else if (auth.method === "service-account") {
      requireValue(auth, "secretRef", `${path}.authentication`);
      if (auth.registrationRef) fieldErrors[`${path}.authentication.registrationRef`] = FIELD_ERRORS.serviceAccountRegistration;
      if (integration.accountMode === "per-user") fieldErrors[`${path}.accountMode`] = FIELD_ERRORS.serviceAccountPerUser;
    } else {
      for (const field of ["secretRef", "registrationRef"]) {
        if (Object.hasOwn(auth, field)) fieldErrors[`${path}.authentication.${field}`] = FIELD_ERRORS.noCredentials;
      }
    }
    if (new Set(integration.scopes).size !== integration.scopes.length) {
      fieldErrors[`${path}.scopes`] = FIELD_ERRORS.duplicateScope;
    }
    if (providers.length) {
      if (!provider) {
        if (!allowUnknownProviders) fieldErrors[`${path}.provider`] = FIELD_ERRORS.providerUnregistered;
        continue;
      }
      for (const action of Object.keys(integration.assistantPolicy?.actions || {})) {
        if (!provider.assistantActions?.some((item) => item.value === action)) {
          fieldErrors[`${path}.assistantPolicy.actions.${action}`] = FIELD_ERRORS.assistantActionUndeclared;
        }
      }
      if (provider.settingsSchema) {
        try {
          integration.settings = validateSchemaPayload({ schema: getProviderSettingsSchema(provider, integration.settings), mode: "replace" }, integration.settings || {});
        } catch (error) {
          const { messages, codes } = schemaFieldErrors(error, { settings: FIELD_ERRORS.providerSettings }, `${path}.settings.`);
          Object.assign(fieldErrors, messages);
          Object.assign(fieldErrorCodes, codes);
        }
      }
      for (const field of provider.settingsFields || []) {
        if (field.authenticationMethods && !field.authenticationMethods.includes(auth.method) && Object.hasOwn(integration.settings || {}, field.name)) {
          fieldErrors[`${path}.settings.${field.name}`] = FIELD_ERRORS.otherCredentialModeSetting;
        }
      }
      if (!getProviderAccountModes(provider, integration.settings || {}).includes(integration.accountMode)) {
        fieldErrors[`${path}.accountMode`] = FIELD_ERRORS.accountModeUnsupported;
      }
      if (!getProviderAuthenticationMethods(provider, integration.settings).includes(auth.method)) {
        fieldErrors[`${path}.authentication.method`] = FIELD_ERRORS.credentialModeUnsupported;
      }
      if (auth.method === "oauth2" && registration?.source === "own") {
        const registrationPath = `registrations.${auth.registrationRef}`;
        if (!providerGrantTypes(provider).includes(grantType)) {
          fieldErrors[`${registrationPath}.grantType`] = FIELD_ERRORS.oauthFlowUnsupported;
        }
        const methods = getProviderClientAuthenticationMethods(provider, grantType, integration.settings || {});
        if (!methods.includes(registrationClientAuthentication(registration))) {
          fieldErrors[`${registrationPath}.tokenEndpointAuthMethod`] = FIELD_ERRORS.clientAuthenticationUnsupported;
        }
        if (registration.clientId && provider.validateClientId) {
          const result = provider.validateClientId(registration.clientId);
          if (result !== true) fieldErrors[`${registrationPath}.clientId`] = result || FIELD_ERRORS.clientId;
        }
      }
      const scopes = getProviderScopes(provider, integration.settings || {}, grantType, auth.method);
      const allowedScopes = new Set(scopes.map((scope) => scope.value));
      if (scopes.some((scope) => scope.required && !integration.scopes.includes(scope.value))) {
        fieldErrors[`${path}.scopes`] = FIELD_ERRORS.requiredScopes;
      }
      if (integration.scopes.some((scope) => !allowedScopes.has(scope))) {
        fieldErrors[`${path}.scopes`] = FIELD_ERRORS.scopeUnsupported;
      }
      if (["oauth2", "service-account"].includes(auth.method) && scopes.length && !integration.scopes.length) {
        fieldErrors[`${path}.scopes`] = FIELD_ERRORS.scopeRequired;
      }
    }
  }
  if (Object.keys(fieldErrors).length) throw new IntegrationConfigurationError(fieldErrors, fieldErrorCodes);
  return config;
}

function parseIntegrationConfiguration(text, options) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new IntegrationConfigurationError({ configuration: FIELD_ERRORS.invalidJson });
  }
  return validateIntegrationConfiguration(value, options);
}

export {
  DEFAULT_GRANT_TYPE,
  DEFAULT_TOKEN_ENDPOINT_AUTH_METHOD,
  MESSAGE_KEY_SOURCE,
  registrationGrantType,
  registrationClientAuthentication,
  providerGrantTypes,
  getProviderAuthenticationMethods,
  getProviderClientAuthenticationMethods,
  getProviderAccountModes,
  getProviderScopes,
  getProviderSettingsSchema,
  getProviderSetup,
  isProviderConfigurationOnly,
  secretReference,
  integrationsSchema,
  IntegrationConfigurationError,
  parseIntegrationConfiguration,
  validateIntegrationConfiguration
};
