import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";

const name = { type: "string", required: true, minLength: 1, maxLength: 200 };
const secretReference = {
  ...name,
  validator: (value) => (/^[a-z][a-z0-9-]*:[^\s]+$/u.test(value) && !/^https?:/u.test(value)) || "Use a reference such as env:VARIABLE_NAME."
};
const authenticationSchema = createSchema({
  method: { ...name, enum: ["oauth2", "api-key", "service-account", "none"] },
  registrationRef: { ...name, required: false },
  secretRef: { ...secretReference, required: false }
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

class IntegrationConfigurationError extends Error {
  constructor(fieldErrors) {
    super("Integration configuration is invalid.");
    this.name = "IntegrationConfigurationError";
    this.code = "integration_configuration_invalid";
    this.statusCode = 422;
    this.fieldErrors = fieldErrors;
  }
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

function getProviderScopes(provider, settings = {}, grantType = "authorization_code", authenticationMethod) {
  const scopes = provider.scopesForGrantType ? provider.scopesForGrantType(grantType, settings)
    : provider.scopesForSettings ? provider.scopesForSettings(settings) : provider.scopes;
  return authenticationMethod ? scopes.filter(scope => !scope.authenticationMethods || scope.authenticationMethods.includes(authenticationMethod)) : scopes;
}

function getProviderClientAuthenticationMethods(provider, grantType = "authorization_code", settings = {}) {
  const methods = provider.oauthClientAuthenticationMethods;
  return typeof methods === "function" ? methods(grantType, settings) : methods || ["client_secret_post"];
}

function validateIntegrationConfiguration(input, { providers = [], allowUnknownProviders = false } = {}) {
  if (input?.schemaVersion !== 1) {
    throw new IntegrationConfigurationError({ schemaVersion: "Use numeric schemaVersion 1; other versions require an explicit migration." });
  }
  let config;
  try {
    config = validateSchemaPayload({ schema: integrationsSchema, mode: "replace" }, input);
  } catch (error) {
    throw new IntegrationConfigurationError(error.fieldErrors || { configuration: "Invalid configuration." });
  }
  const fieldErrors = {};
  const definitions = new Map(providers.map((provider) => [provider.id, provider]));
  const requireValue = (record, key, path) => {
    if (!record[key]) fieldErrors[`${path}.${key}`] = "This value is required.";
  };
  for (const field of ["integrations", "registrations"]) {
    for (const id of Object.keys(config[field])) {
      if (!/^[a-z][a-z0-9-]*$/u.test(id) || ["constructor", "prototype"].includes(id)) {
        fieldErrors[`${field}.${id}`] = "Use a stable lowercase name containing letters, digits and hyphens.";
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
      if (Object.hasOwn(registration, key)) fieldErrors[`${path}.${key}`] = "This field belongs to another credential mode.";
    }
    if (clientCredentials && registration.tokenEndpointAuthMethod === "none") {
      fieldErrors[`${path}.tokenEndpointAuthMethod`] = "Client credentials require a confidential client.";
    }
  }
  for (const [id, integration] of Object.entries(config.integrations)) {
    const path = `integrations.${id}`;
    const auth = integration.authentication;
    const provider = definitions.get(integration.provider);
    const registration = config.registrations[auth.registrationRef];
    const grantType = registration?.grantType || "authorization_code";
    if (auth.method === "oauth2") {
      if (!auth.registrationRef || !Object.hasOwn(config.registrations, auth.registrationRef)) {
        fieldErrors[`${path}.authentication.registrationRef`] = "Select a registration defined in this file.";
      }
      if (auth.secretRef) fieldErrors[`${path}.authentication.secretRef`] = "Use the registration's secret reference.";
      if (grantType === "client_credentials" && integration.accountMode === "per-user") {
        fieldErrors[`${path}.accountMode`] = "A service account cannot connect as each app user.";
      }
    } else if (auth.method === "api-key") {
      if (!provider?.apiKeySecretOptional) requireValue(auth, "secretRef", `${path}.authentication`);
      if (auth.registrationRef) fieldErrors[`${path}.authentication.registrationRef`] = "API keys do not use an OAuth registration.";
    } else if (auth.method === "service-account") {
      requireValue(auth, "secretRef", `${path}.authentication`);
      if (auth.registrationRef) fieldErrors[`${path}.authentication.registrationRef`] = "Service-account credentials do not use a browser OAuth registration.";
      if (integration.accountMode === "per-user") fieldErrors[`${path}.accountMode`] = "A service account cannot connect as each app user.";
    } else {
      for (const field of ["secretRef", "registrationRef"]) {
        if (Object.hasOwn(auth, field)) fieldErrors[`${path}.authentication.${field}`] = "This mode does not use credentials.";
      }
    }
    if (new Set(integration.scopes).size !== integration.scopes.length) {
      fieldErrors[`${path}.scopes`] = "Select each permission only once.";
    }
    if (providers.length) {
      if (!provider) {
        if (!allowUnknownProviders) fieldErrors[`${path}.provider`] = "Install and register this provider before using it.";
        continue;
      }
      for (const action of Object.keys(integration.assistantPolicy?.actions || {})) {
        if (!provider.assistantActions?.some((item) => item.value === action)) {
          fieldErrors[`${path}.assistantPolicy.actions.${action}`] = "This provider does not declare this assistant action.";
        }
      }
      if (provider.settingsSchema) {
        try {
          integration.settings = validateSchemaPayload({ schema: getProviderSettingsSchema(provider, integration.settings), mode: "replace" }, integration.settings || {});
        } catch (error) {
          for (const [field, message] of Object.entries(error.fieldErrors || { settings: "Check this provider's settings." })) {
            fieldErrors[`${path}.settings.${field}`] = message;
          }
        }
      }
      for (const field of provider.settingsFields || []) {
        if (field.authenticationMethods && !field.authenticationMethods.includes(auth.method) && Object.hasOwn(integration.settings || {}, field.name)) {
          fieldErrors[`${path}.settings.${field.name}`] = "This setting belongs to another credential mode.";
        }
      }
      if (!getProviderAccountModes(provider, integration.settings || {}).includes(integration.accountMode)) {
        fieldErrors[`${path}.accountMode`] = "This provider does not support this account mode.";
      }
      if (!getProviderAuthenticationMethods(provider, integration.settings).includes(auth.method)) {
        fieldErrors[`${path}.authentication.method`] = "This provider configuration does not support this credential mode.";
      }
      if (auth.method === "oauth2" && registration?.source === "own") {
        const registrationPath = `registrations.${auth.registrationRef}`;
        if (!(provider.oauthGrantTypes || ["authorization_code"]).includes(grantType)) {
          fieldErrors[`${registrationPath}.grantType`] = "This provider does not support this OAuth flow.";
        }
        const methods = getProviderClientAuthenticationMethods(provider, grantType, integration.settings || {});
        if (!methods.includes(registration.tokenEndpointAuthMethod || "client_secret_post")) {
          fieldErrors[`${registrationPath}.tokenEndpointAuthMethod`] = "This provider does not support this client authentication method.";
        }
        if (registration.clientId && provider.validateClientId) {
          const result = provider.validateClientId(registration.clientId);
          if (result !== true) fieldErrors[`${registrationPath}.clientId`] = result || "Check this provider's client identifier.";
        }
      }
      const scopes = getProviderScopes(provider, integration.settings || {}, grantType, auth.method);
      const allowedScopes = new Set(scopes.map((scope) => scope.value));
      if (scopes.some((scope) => scope.required && !integration.scopes.includes(scope.value))) {
        fieldErrors[`${path}.scopes`] = "Include this provider's required permissions.";
      }
      if (integration.scopes.some((scope) => !allowedScopes.has(scope))) {
        fieldErrors[`${path}.scopes`] = "A selected permission is not supported by this provider configuration.";
      }
      if (["oauth2", "service-account"].includes(auth.method) && scopes.length && !integration.scopes.length) {
        fieldErrors[`${path}.scopes`] = "Select at least one permission.";
      }
    }
  }
  if (Object.keys(fieldErrors).length) throw new IntegrationConfigurationError(fieldErrors);
  return config;
}

function parseIntegrationConfiguration(text, options) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new IntegrationConfigurationError({ configuration: "Enter valid JSON." });
  }
  return validateIntegrationConfiguration(value, options);
}

export {
  getProviderAuthenticationMethods,
  getProviderClientAuthenticationMethods,
  getProviderAccountModes,
  getProviderScopes,
  getProviderSettingsSchema,
  secretReference,
  integrationsSchema,
  IntegrationConfigurationError,
  parseIntegrationConfiguration,
  validateIntegrationConfiguration
};
