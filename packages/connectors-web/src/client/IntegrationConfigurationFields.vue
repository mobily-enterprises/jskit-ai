<script setup>
import { computed, ref } from "vue";
import { DEFAULT_GRANT_TYPE, DEFAULT_TOKEN_ENDPOINT_AUTH_METHOD, MESSAGE_KEY_SOURCE, getProviderAccountModes, getProviderAuthenticationMethods, getProviderClientAuthenticationMethods, getProviderScopes, getProviderSettingsSchema, providerGrantTypes, registrationClientAuthentication, registrationGrantType } from "@jskit-ai/connectors-core/shared/configuration";
import { useJskitText } from "./i18n.js";

const props = defineProps({
  modelValue: { type: Object, required: true },
  integrationId: { type: String, required: true },
  provider: { type: Object, required: true },
  fieldErrors: { type: Object, default: () => ({}) },
  // The coded form of fieldErrors (IntegrationConfigurationError.fieldErrorCodes), so they can be translated.
  fieldErrorCodes: { type: Object, default: () => ({}) },
  disabled: Boolean,
  callbackUrl: { type: String, default: "" }
});
const emit = defineEmits(["update:modelValue"]);
// Provider texts may be message keys (the JSKIT catalog) or plain text (other catalogs); text() renders both.
// The catalog's public definitions are English; each keeps its keyed original under MESSAGE_KEY_SOURCE.
const jskitText = useJskitText();
const { t, text, formatDate, fieldErrorMessages } = jskitText;
const definition = computed(() => props.provider[MESSAGE_KEY_SOURCE] || props.provider);
const errors = computed(() => fieldErrorMessages({ fieldErrors: props.fieldErrors, fieldErrorCodes: props.fieldErrorCodes }));
const panels = ref(["details", "credentials"]);
const integration = computed(() => props.modelValue.integrations[props.integrationId]);
const registrationId = computed(() => integration.value?.authentication.registrationRef);
const registration = computed(() => props.modelValue.registrations[registrationId.value]);
const grantType = computed(() => registrationGrantType(registration.value));
const grantTitles = { authorization_code: "jskit.connectors.configurationFields.grantTypes.authorizationCode", client_credentials: "jskit.connectors.configurationFields.grantTypes.clientCredentials" };
const grantOptions = computed(() => providerGrantTypes(definition.value).map((value) => ({
  value, title: grantTitles[value] ? t(grantTitles[value]) : value
})));
const modeTitles = { shared: "jskit.connectors.configurationFields.accountModes.shared", "per-user": "jskit.connectors.configurationFields.accountModes.perUser", assistant: "jskit.connectors.configurationFields.accountModes.assistant" };
const modes = computed(() => getProviderAccountModes(definition.value, integration.value.settings || {}).filter((mode) =>
  integration.value?.authentication.method !== "oauth2" || grantType.value !== "client_credentials" || mode !== "per-user"
).map((value) => ({
  value,
  title: modeTitles[value] ? t(modeTitles[value]) : value
})));
const registrationOptions = computed(() => Object.keys(props.modelValue.registrations));
const integrationPath = computed(() => `integrations.${props.integrationId}`);
const registrationPath = computed(() => `registrations.${registrationId.value}`);
const settingProperties = computed(() => getProviderSettingsSchema(definition.value, integration.value?.settings)?.getFieldDefinitions() || {});
const methodTitles = { "api-key": "jskit.connectors.configurationFields.authenticationMethods.apiKey", "service-account": "jskit.connectors.configurationFields.authenticationMethods.serviceAccount",
  oauth2: "jskit.connectors.configurationFields.authenticationMethods.oauth2", none: "jskit.connectors.configurationFields.authenticationMethods.none" };
const authenticationOptions = computed(() => getProviderAuthenticationMethods(definition.value, integration.value.settings).map((value) => ({
  value, title: text(definition.value.authenticationLabels?.[value]) || (methodTitles[value] ? t(methodTitles[value]) : value)
})));
const visibleSettings = computed(() => (definition.value.settingsFields || []).filter((field) =>
  Object.hasOwn(settingProperties.value, field.name) &&
  (!field.authenticationMethods || field.authenticationMethods.includes(integration.value.authentication.method))
));
const visibleScopes = computed(() => getProviderScopes(definition.value, integration.value.settings || {}, grantType.value, integration.value.authentication.method));
const clientSecretHint = computed(() =>
  t("jskit.connectors.configurationFields.clientSecretReference.hint", { prefix: environmentPrefix(registrationId.value || props.integrationId) }));
const assistantPermissions = computed(() => [
  { value: "ask", title: t("jskit.connectors.configurationFields.assistantPermissions.ask") },
  { value: "always", title: t("jskit.connectors.configurationFields.assistantPermissions.always") },
  { value: "never", title: t("jskit.connectors.configurationFields.assistantPermissions.never") }
]);
const credentialReference = computed(() => integration.value?.authentication.method === "service-account"
  ? { label: text(definition.value.serviceAccountReferenceLabel) || t("jskit.connectors.configurationFields.serviceAccountReference.label"),
    hint: text(definition.value.serviceAccountReferenceHint) || t("jskit.connectors.configurationFields.serviceAccountReference.hint") }
  : { label: text(definition.value.apiKeyReferenceLabel) || t("jskit.connectors.configurationFields.apiKeyReference.label"),
    hint: text(definition.value.apiKeyReferenceHint) || t("jskit.connectors.configurationFields.apiKeyReference.hint") });

// The environment-variable prefix editAuthentication uses for a new registration's references.
function environmentPrefix(id) {
  return id.toUpperCase().replaceAll("-", "_");
}

// A service account cannot connect as each app user; fall back to a mode these settings allow.
function accountModeForGrant(grant, settings, accountMode) {
  return grant === "client_credentials" && accountMode === "per-user"
    ? getProviderAccountModes(definition.value, settings || {}).find((mode) => mode !== "per-user") : accountMode;
}

function settingValue(field) {
  return integration.value.settings?.[field.name] ?? settingProperties.value[field.name]?.defaultTo;
}

// A hint function receives formatDate so dates it shows follow the app's language (none: its own English).
function settingHint(field) {
  return text(typeof field.hint === "function" ? field.hint(integration.value.settings, jskitText.locale ? { formatDate } : {}) : field.hint);
}

function settingItems(field) {
  return field.items?.map((item) => item && typeof item === "object" ? {
    ...item,
    ...(item.title !== undefined ? { title: text(item.title) } : {}),
    ...(item.props?.subtitle !== undefined ? { props: { ...item.props, subtitle: text(item.props.subtitle) } } : {})
  } : item);
}

function settingErrors(field) {
  return errors.value[`${integrationPath.value}.settings.${field.name}`];
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
  if (typeof definition.value.settingsSchema === "function") {
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
</script>

<template>
  <v-sheet v-if="integration" class="integration-fields" :aria-label="t('jskit.connectors.configurationFields.ariaLabel', { provider: definition.name })">
    <v-expansion-panels v-model="panels" multiple variant="accordion" :disabled="disabled">
      <v-expansion-panel value="details" :title="t('jskit.connectors.configurationFields.panels.details')">
        <v-expansion-panel-text>
          <v-text-field
            :label="t('jskit.connectors.configurationFields.displayName.label')" :model-value="integration.displayName || ''" :disabled="disabled"
            :placeholder="definition.name" :error-messages="errors[`${integrationPath}.displayName`]"
            @update:model-value="editIntegration({ displayName: $event || undefined })"
          />
          <v-select
            :label="t('jskit.connectors.configurationFields.accountMode.label')" :items="modes" :model-value="integration.accountMode" :disabled="disabled"
            :error-messages="errors[`${integrationPath}.accountMode`]"
            @update:model-value="editIntegration({ accountMode: $event })"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel value="credentials" :title="t('jskit.connectors.configurationFields.panels.credentials')">
        <v-expansion-panel-text>
          <v-select
            v-if="authenticationOptions.length > 1"
            :label="t('jskit.connectors.configurationFields.authentication.label')" :items="authenticationOptions" :model-value="integration.authentication.method" :disabled="disabled"
            :hint="text(definition.authenticationHint)" :persistent-hint="Boolean(definition.authenticationHint)"
            :error-messages="errors[`${integrationPath}.authentication.method`]"
            @update:model-value="editAuthentication"
          />
          <template v-for="field in visibleSettings" :key="field.name">
            <v-autocomplete
              v-if="field.searchable"
              :label="text(field.label)" :items="settingItems(field)" :disabled="disabled" auto-select-first
              :model-value="settingValue(field)"
              :hint="settingHint(field)" persistent-hint :error-messages="settingErrors(field)"
              @update:model-value="editSetting(field.name, $event)"
            />
            <v-select
              v-else-if="field.items"
              :label="text(field.label)" :items="settingItems(field)" :disabled="disabled"
              :model-value="settingValue(field)"
              :hint="settingHint(field)" persistent-hint :error-messages="settingErrors(field)"
              @update:model-value="editSetting(field.name, $event)"
            />
            <v-text-field
              v-else
              :label="text(field.label)" :disabled="disabled" :placeholder="text(field.placeholder)"
              :model-value="settingValue(field) ?? ''"
              :hint="settingHint(field)" persistent-hint :error-messages="settingErrors(field)"
              @update:model-value="editSetting(field.name, $event)"
            />
          </template>
          <template v-if="['api-key', 'service-account'].includes(integration.authentication.method)">
            <slot name="credential" :reference="integration.authentication.secretRef" :disabled="disabled">
              <v-text-field
                :label="credentialReference.label" :model-value="integration.authentication.secretRef" :disabled="disabled"
                :hint="credentialReference.hint"
                persistent-hint :error-messages="errors[`${integrationPath}.authentication.secretRef`]"
                @update:model-value="editSecretReference"
              />
            </slot>
          </template>
          <template v-else-if="integration.authentication.method === 'oauth2'">
            <v-select
              :label="t('jskit.connectors.configurationFields.registration.label')" :items="registrationOptions" :model-value="registrationId" :disabled="disabled"
              :error-messages="errors[`${integrationPath}.authentication.registrationRef`]"
              @update:model-value="editIntegration({ authentication: { ...integration.authentication, registrationRef: $event } })"
            />
            <template v-if="registration?.source === 'own'">
              <v-select
                v-if="grantOptions.length > 1"
                :label="t('jskit.connectors.configurationFields.grantType.label')" :items="grantOptions" :model-value="grantType" :disabled="disabled"
                :hint="text(definition.oauthGrantHint)" :persistent-hint="Boolean(definition.oauthGrantHint)"
                :error-messages="errors[`${registrationPath}.grantType`]"
                @update:model-value="editGrantType"
              />
              <v-text-field
                :label="text(definition.clientIdLabel) || t('jskit.connectors.configurationFields.clientId.label')" :hint="text(definition.clientIdHint)" :persistent-hint="Boolean(definition.clientIdHint)" :model-value="registration.clientId" autocomplete="off" :disabled="disabled"
                :error-messages="errors[`${registrationPath}.clientId`]"
                @update:model-value="editRegistration('clientId', $event)"
              />
              <slot v-if="registration.tokenEndpointAuthMethod !== 'none'" name="credential" :reference="registration.clientSecretRef" :disabled="disabled">
                <v-text-field
                  :label="t('jskit.connectors.configurationFields.clientSecretReference.label')" :model-value="registration.clientSecretRef" :disabled="disabled"
                  :hint="clientSecretHint"
                  persistent-hint :error-messages="errors[`${registrationPath}.clientSecretRef`]"
                  @update:model-value="editRegistration('clientSecretRef', $event)"
                />
              </slot>
              <v-text-field
                v-if="grantType === 'authorization_code'"
                :hint="t('jskit.connectors.configurationFields.callbackUrlReference.hint')" persistent-hint
                class="mt-4" :label="t('jskit.connectors.configurationFields.callbackUrlReference.label')" :model-value="registration.callbackUrlRef" :disabled="disabled"
                :error-messages="errors[`${registrationPath}.callbackUrlRef`]"
                @update:model-value="editRegistration('callbackUrlRef', $event)"
              />
              <v-text-field v-if="callbackUrl && grantType === 'authorization_code'" :label="t('jskit.connectors.configurationFields.callbackUrl.label')" :model-value="callbackUrl" readonly />
            </template>
          </template>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel v-if="visibleScopes.length && (definition.scopes.length || definition.permissionsHint || ['oauth2', 'service-account'].includes(integration.authentication.method))" value="permissions" :title="t('jskit.connectors.configurationFields.panels.permissions')">
        <v-expansion-panel-text>
          <p class="text-body-medium mb-3">{{ text(definition.permissionsHint) || t('jskit.connectors.configurationFields.permissions.hint') }}</p>
          <v-checkbox
            v-for="permission in visibleScopes" :key="permission.value"
            :label="text(permission.label)" :value="permission.value" :model-value="integration.scopes" :disabled="disabled || permission.required"
            hide-details @update:model-value="editIntegration({ scopes: $event })"
          />
          <p v-if="errors[`${integrationPath}.scopes`]" role="alert" class="text-error text-body-small mt-2">
            {{ errors[`${integrationPath}.scopes`] }}
          </p>
        </v-expansion-panel-text>
      </v-expansion-panel>
      <v-expansion-panel v-if="definition.assistantActions?.length" value="assistant" :title="t('jskit.connectors.configurationFields.panels.assistant')">
        <v-expansion-panel-text>
          <p class="text-body-medium mb-3">{{ t('jskit.connectors.configurationFields.assistant.hint') }}</p>
          <v-switch
            :label="t('jskit.connectors.configurationFields.assistant.enabled.label')" :model-value="integration.assistantPolicy?.enabled ?? true" :disabled="disabled"
            :error-messages="errors[`${integrationPath}.assistantPolicy.enabled`]"
            @update:model-value="editAssistantPolicy({ enabled: $event })"
          />
          <v-select
            :label="t('jskit.connectors.configurationFields.assistant.defaultPermission.label')" :items="assistantPermissions" :model-value="integration.assistantPolicy?.defaultPermission || 'ask'"
            :disabled="disabled || integration.assistantPolicy?.enabled === false"
            :hint="t('jskit.connectors.configurationFields.assistant.defaultPermission.hint')" persistent-hint
            :error-messages="errors[`${integrationPath}.assistantPolicy.defaultPermission`]"
            @update:model-value="editAssistantPolicy({ defaultPermission: $event, actions: {} })"
          />
          <v-select
            v-for="action in definition.assistantActions" :key="action.value" :label="text(action.label)" :items="assistantPermissions"
            :model-value="integration.assistantPolicy?.actions?.[action.value] || integration.assistantPolicy?.defaultPermission || 'ask'"
            :disabled="disabled || integration.assistantPolicy?.enabled === false"
            :error-messages="errors[`${integrationPath}.assistantPolicy.actions.${action.value}`]"
            @update:model-value="editAssistantPolicy({ actions: { ...integration.assistantPolicy?.actions, [action.value]: $event } })"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
    <slot name="access" :integration="integration" />
  </v-sheet>
</template>

<style scoped>
.integration-fields { min-width: 0; }
</style>
