import { computed } from "vue";
import { DEFAULT_GRANT_TYPE, DEFAULT_TOKEN_ENDPOINT_AUTH_METHOD, MESSAGE_KEY_SOURCE, getProviderAccountModes, getProviderAuthenticationMethods, getProviderClientAuthenticationMethods, getProviderScopes, getProviderSettingsSchema, registrationClientAuthentication, registrationGrantType } from "@jskit-ai/connectors-core/shared/configuration";

// The environment-variable prefix editAuthentication uses for a new registration's references.
function environmentPrefix(id) {
  return id.toUpperCase().replaceAll("-", "_");
}

// readable-check: allow method-probe - input validation: a provider's settingsSchema is a schema, or a function of the settings
function hasSettingsFunction(provider) {
  return typeof provider.settingsSchema === "function";
}

/**
 * The integration a component edits: what it reads from the configuration, and each change it emits.
 * @param {object} options
 * @param {import("./types.js").IntegrationConfigurationProps} options.props
 * @param {(event: "update:modelValue", configuration: import("./types.js").IntegrationConfiguration) => void} options.emit
 */
function useIntegrationConfiguration({ props, emit }) {
  // The catalog's public definitions are English; each keeps its keyed original under MESSAGE_KEY_SOURCE.
  const definition = computed(() => props.provider[MESSAGE_KEY_SOURCE] || props.provider);
  const integration = computed(() => props.modelValue.integrations[props.integrationId]);
  const registrationId = computed(() => integration.value?.authentication.registrationRef);
  const registration = computed(() => props.modelValue.registrations[registrationId.value]);
  const grantType = computed(() => registrationGrantType(registration.value));
  const settingProperties = computed(() => getProviderSettingsSchema(definition.value, integration.value?.settings)?.getFieldDefinitions() || {});

  // A service account cannot connect as each app user; fall back to a mode these settings allow.
  function accountModeForGrant(grant, settings, accountMode) {
    return grant === "client_credentials" && accountMode === "per-user"
      ? getProviderAccountModes(definition.value, settings || {}).find((mode) => mode !== "per-user") : accountMode;
  }

  function editAssistantPolicy(changes) {
    editIntegration({ assistantPolicy: { enabled: true, defaultPermission: "ask", actions: {}, ...integration.value.assistantPolicy, ...changes } });
  }

  function editIntegration(changes) {
    const next = { ...integration.value, ...changes };
    for (const key of Object.keys(changes)) if (changes[key] === undefined) delete next[key];
    const registrations = { ...props.modelValue.registrations };
    const previousRegistration = registrationId.value;
    if (changes.authentication && next.authentication.method !== "oauth2" && previousRegistration &&
        registrations[previousRegistration]?.source === "own" && registrations[previousRegistration]?.clientId === "" &&
        !Object.entries(props.modelValue.integrations).some(([id, value]) =>
          id !== props.integrationId && value.authentication.registrationRef === previousRegistration)) {
      delete registrations[previousRegistration];
    }
    emit("update:modelValue", {
      ...props.modelValue,
      registrations,
      integrations: { ...props.modelValue.integrations, [props.integrationId]: next }
    });
  }

  function editSetting(field, value) {
    const settings = { ...integration.value.settings };
    if (value === undefined || value === "") delete settings[field];
    else settings[field] = value;
    if (hasSettingsFunction(definition.value)) {
      const fields = getProviderSettingsSchema(definition.value, settings).getFieldDefinitions();
      for (const key of Object.keys(settings)) if (!Object.hasOwn(fields, key)) delete settings[key];
    }
    const available = getProviderScopes(definition.value, settings, grantType.value, integration.value.authentication.method);
    const scopes = integration.value.scopes.filter((value) => available.some((scope) => scope.value === value));
    for (const scope of available) if (scope.required && !scopes.includes(scope.value)) scopes.push(scope.value);
    const methods = getProviderAuthenticationMethods(definition.value, settings);
    const credentialScope = definition.value.settingsFields?.find((item) => item.name === field)?.credentialScope;
    const changedProvider = credentialScope && credentialScope(value) !== credentialScope(integration.value.settings?.[field] ?? settingProperties.value[field]?.defaultTo);
    const authentication = changedProvider || !methods.includes(integration.value.authentication.method)
      ? { method: methods[0] } : integration.value.authentication;
    const accountModes = getProviderAccountModes(definition.value, settings);
    const accountMode = accountModes.includes(integration.value.accountMode) ? integration.value.accountMode : accountModes[0];
    if (authentication.method === "oauth2" && !authentication.registrationRef) {
      editAuthentication("oauth2", { ...integration.value, settings, scopes, authentication, accountMode });
    } else editIntegration({ settings, scopes, authentication, accountMode });
  }

  function editAuthentication(method, current = integration.value) {
    const settings = { ...current.settings };
    for (const field of definition.value.settingsFields || []) {
      if (field.authenticationMethods && !field.authenticationMethods.includes(method)) delete settings[field.name];
    }
    const grant = method === "oauth2" ? definition.value.oauthGrantTypes?.[0] || DEFAULT_GRANT_TYPE : DEFAULT_GRANT_TYPE;
    const availableScopes = getProviderScopes(definition.value, settings, grant, method);
    const scopes = availableScopes.filter(scope => current.scopes.includes(scope.value) || scope.required || (scope.authenticationMethods && scope.recommended)).map(scope => scope.value);
    if (method === "oauth2") {
      let id = props.integrationId;
      let suffix = 2;
      while (Object.hasOwn(props.modelValue.registrations, id)) id = `${props.integrationId}-${suffix++}`;
      const prefix = environmentPrefix(id);
      const clientAuthentication = getProviderClientAuthenticationMethods(definition.value, grant, settings)[0];
      emit("update:modelValue", {
        ...props.modelValue,
        integrations: { ...props.modelValue.integrations, [props.integrationId]: {
          ...current, scopes, authentication: { method, registrationRef: id },
          accountMode: accountModeForGrant(grant, settings, current.accountMode),
          ...(current.settings ? { settings } : {})
        } },
        registrations: { ...props.modelValue.registrations, [id]: {
          source: "own", clientId: "",
          ...(grant === "authorization_code" ? { callbackUrlRef: `env:${prefix}_CALLBACK_URL` } : { grantType: grant }),
          ...(clientAuthentication !== DEFAULT_TOKEN_ENDPOINT_AUTH_METHOD ? { tokenEndpointAuthMethod: clientAuthentication } : {}),
          ...(clientAuthentication !== "none" ? { clientSecretRef: `env:${prefix}_CLIENT_SECRET` } : {})
        } }
      });
      return;
    }
    editIntegration({ scopes, authentication: { method }, ...(current.settings ? { settings } : {}) });
  }

  function editSecretReference(value) {
    const authentication = { ...integration.value.authentication, secretRef: value };
    if (!value && definition.value.apiKeySecretOptional) delete authentication.secretRef;
    editIntegration({ authentication });
  }

  function editRegistration(field, value) {
    emit("update:modelValue", {
      ...props.modelValue,
      registrations: {
        ...props.modelValue.registrations,
        [registrationId.value]: { ...registration.value, [field]: value }
      }
    });
  }

  function editGrantType(value) {
    const nextRegistration = { ...registration.value, grantType: value };
    const methods = getProviderClientAuthenticationMethods(definition.value, value, integration.value.settings || {});
    if (!methods.includes(registrationClientAuthentication(nextRegistration))) nextRegistration.tokenEndpointAuthMethod = methods[0];
    if (nextRegistration.tokenEndpointAuthMethod === "none") delete nextRegistration.clientSecretRef;
    if (value === "client_credentials") delete nextRegistration.callbackUrlRef;
    const allowed = getProviderScopes(definition.value, integration.value.settings || {}, value, integration.value.authentication.method).map((scope) => scope.value);
    emit("update:modelValue", {
      ...props.modelValue,
      registrations: { ...props.modelValue.registrations, [registrationId.value]: nextRegistration },
      integrations: { ...props.modelValue.integrations, [props.integrationId]: {
        ...integration.value,
        accountMode: accountModeForGrant(value, integration.value.settings, integration.value.accountMode),
        scopes: integration.value.scopes.filter((scope) => allowed.includes(scope))
      } }
    });
  }

  return {
    definition,
    integration,
    registrationId,
    registration,
    grantType,
    settingProperties,
    editAssistantPolicy,
    editIntegration,
    editSetting,
    editAuthentication,
    editSecretReference,
    editRegistration,
    editGrantType
  };
}

export { environmentPrefix, useIntegrationConfiguration };
