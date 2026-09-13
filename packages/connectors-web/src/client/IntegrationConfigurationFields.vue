<script setup>
import { computed, ref } from "vue";
import { getProviderAccountModes, getProviderAuthenticationMethods, getProviderClientAuthenticationMethods, getProviderScopes, getProviderSettingsSchema } from "@jskit-ai/connectors-core/shared/configuration";

const props = defineProps({
  modelValue: { type: Object, required: true },
  integrationId: { type: String, required: true },
  provider: { type: Object, required: true },
  fieldErrors: { type: Object, default: () => ({}) },
  disabled: Boolean,
  callbackUrl: { type: String, default: "" }
});
const emit = defineEmits(["update:modelValue"]);
const panels = ref(["details", "credentials"]);
const integration = computed(() => props.modelValue.integrations[props.integrationId]);
const registrationId = computed(() => integration.value?.authentication.registrationRef);
const registration = computed(() => props.modelValue.registrations[registrationId.value]);
const grantType = computed(() => registration.value?.grantType || "authorization_code");
const grantOptions = computed(() => (props.provider.oauthGrantTypes || ["authorization_code"]).map((value) => ({
  value, title: { authorization_code: "User consent", client_credentials: "Service account" }[value] || value
})));
const modes = computed(() => getProviderAccountModes(props.provider, integration.value.settings || {}).filter((mode) =>
  integration.value?.authentication.method !== "oauth2" || grantType.value !== "client_credentials" || mode !== "per-user"
).map((value) => ({
  value,
  title: { shared: "One shared account", "per-user": "Each app user's own account", assistant: "Assistant access" }[value] || value
})));
const registrationOptions = computed(() => Object.keys(props.modelValue.registrations));
const integrationPath = computed(() => `integrations.${props.integrationId}`);
const registrationPath = computed(() => `registrations.${registrationId.value}`);
const settingProperties = computed(() => getProviderSettingsSchema(props.provider, integration.value?.settings)?.getFieldDefinitions() || {});
const authenticationOptions = computed(() => getProviderAuthenticationMethods(props.provider, integration.value.settings).map((value) => ({
  value, title: props.provider.authenticationLabels?.[value] || { "api-key": "API key", "service-account": "Service account", oauth2: "OAuth", none: "No credentials" }[value] || value
})));
const visibleSettings = computed(() => (props.provider.settingsFields || []).filter((field) =>
  Object.hasOwn(settingProperties.value, field.name) &&
  (!field.authenticationMethods || field.authenticationMethods.includes(integration.value.authentication.method))
));
const visibleScopes = computed(() => getProviderScopes(props.provider, integration.value.settings || {}, grantType.value, integration.value.authentication.method));
const assistantPermissions = [
  { value: "ask", title: "Ask each time" }, { value: "always", title: "Always allow" }, { value: "never", title: "Never allow" }
];

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
  if (typeof props.provider.settingsSchema === "function") {
    const fields = getProviderSettingsSchema(props.provider, settings).getFieldDefinitions();
    for (const key of Object.keys(settings)) if (!Object.hasOwn(fields, key)) delete settings[key];
  }
  const available = getProviderScopes(props.provider, settings, grantType.value, integration.value.authentication.method);
  const scopes = integration.value.scopes.filter((value) => available.some((scope) => scope.value === value));
  for (const scope of available) if (scope.required && !scopes.includes(scope.value)) scopes.push(scope.value);
  const methods = getProviderAuthenticationMethods(props.provider, settings);
  const credentialScope = props.provider.settingsFields?.find((item) => item.name === field)?.credentialScope;
  const changedProvider = credentialScope && credentialScope(value) !== credentialScope(integration.value.settings?.[field] ?? settingProperties.value[field]?.defaultTo);
  const authentication = changedProvider || !methods.includes(integration.value.authentication.method)
    ? { method: methods[0] } : integration.value.authentication;
  const accountModes = getProviderAccountModes(props.provider, settings);
  const accountMode = accountModes.includes(integration.value.accountMode) ? integration.value.accountMode : accountModes[0];
  if (authentication.method === "oauth2" && !authentication.registrationRef) {
    editAuthentication("oauth2", { ...integration.value, settings, scopes, authentication, accountMode });
  } else editIntegration({ settings, scopes, authentication, accountMode });
}

function editAuthentication(method, current = integration.value) {
  const settings = { ...current.settings };
  for (const field of props.provider.settingsFields || []) {
    if (field.authenticationMethods && !field.authenticationMethods.includes(method)) delete settings[field.name];
  }
  const availableScopes = getProviderScopes(props.provider, settings, "authorization_code", method);
  const scopes = availableScopes.filter(scope => current.scopes.includes(scope.value) || scope.required || (scope.authenticationMethods && scope.recommended)).map(scope => scope.value);
  if (method === "oauth2") {
    let id = props.integrationId;
    let suffix = 2;
    while (Object.hasOwn(props.modelValue.registrations, id)) id = `${props.integrationId}-${suffix++}`;
    const prefix = id.toUpperCase().replaceAll("-", "_");
    const grant = props.provider.oauthGrantTypes?.[0] || "authorization_code";
    const clientAuthentication = getProviderClientAuthenticationMethods(props.provider, grant, settings)[0];
    emit("update:modelValue", {
      ...props.modelValue,
      integrations: { ...props.modelValue.integrations, [props.integrationId]: {
        ...current, scopes, authentication: { method, registrationRef: id },
        ...(current.settings ? { settings } : {})
      } },
      registrations: { ...props.modelValue.registrations, [id]: {
        source: "own", clientId: "",
        ...(grant === "authorization_code" ? { callbackUrlRef: `env:${prefix}_CALLBACK_URL` } : { grantType: grant }),
        ...(clientAuthentication !== "client_secret_post" ? { tokenEndpointAuthMethod: clientAuthentication } : {}),
        ...(clientAuthentication !== "none" ? { clientSecretRef: `env:${prefix}_CLIENT_SECRET` } : {})
      } }
    });
    return;
  }
  editIntegration({ scopes, authentication: { method }, ...(current.settings ? { settings } : {}) });
}

function editSecretReference(value) {
  const authentication = { ...integration.value.authentication, secretRef: value };
  if (!value && props.provider.apiKeySecretOptional) delete authentication.secretRef;
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
  const methods = getProviderClientAuthenticationMethods(props.provider, value, integration.value.settings || {});
  if (!methods.includes(nextRegistration.tokenEndpointAuthMethod || "client_secret_post")) nextRegistration.tokenEndpointAuthMethod = methods[0];
  if (nextRegistration.tokenEndpointAuthMethod === "none") delete nextRegistration.clientSecretRef;
  if (value === "client_credentials") delete nextRegistration.callbackUrlRef;
  const allowed = getProviderScopes(props.provider, integration.value.settings || {}, value, integration.value.authentication.method).map((scope) => scope.value);
  emit("update:modelValue", {
    ...props.modelValue,
    registrations: { ...props.modelValue.registrations, [registrationId.value]: nextRegistration },
    integrations: { ...props.modelValue.integrations, [props.integrationId]: {
      ...integration.value,
      accountMode: value === "client_credentials" && integration.value.accountMode === "per-user"
        ? props.provider.accountModes.find((mode) => mode !== "per-user") : integration.value.accountMode,
      scopes: integration.value.scopes.filter((scope) => allowed.includes(scope))
    } }
  });
}
</script>

<template>
  <v-sheet v-if="integration" class="integration-fields" :aria-label="`${provider.name} configuration`">
    <v-expansion-panels v-model="panels" multiple variant="accordion" :disabled="disabled">
      <v-expansion-panel value="details" title="Details">
        <v-expansion-panel-text>
          <v-text-field
            label="Display name" :model-value="integration.displayName || ''" :disabled="disabled"
            :placeholder="provider.name" :error-messages="fieldErrors[`${integrationPath}.displayName`]"
            @update:model-value="editIntegration({ displayName: $event || undefined })"
          />
          <v-select
            label="Account used by the application" :items="modes" :model-value="integration.accountMode" :disabled="disabled"
            :error-messages="fieldErrors[`${integrationPath}.accountMode`]"
            @update:model-value="editIntegration({ accountMode: $event })"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel value="credentials" title="Credentials">
        <v-expansion-panel-text>
          <v-select
            v-if="authenticationOptions.length > 1"
            label="Authentication" :items="authenticationOptions" :model-value="integration.authentication.method" :disabled="disabled"
            :hint="provider.authenticationHint" :persistent-hint="Boolean(provider.authenticationHint)"
            :error-messages="fieldErrors[`${integrationPath}.authentication.method`]"
            @update:model-value="editAuthentication"
          />
          <template v-for="field in visibleSettings" :key="field.name">
            <v-autocomplete
              v-if="field.searchable"
              :label="field.label" :items="field.items" :disabled="disabled" auto-select-first
              :model-value="integration.settings?.[field.name] ?? settingProperties[field.name]?.defaultTo"
              :hint="typeof field.hint === 'function' ? field.hint(integration.settings) : field.hint" persistent-hint :error-messages="fieldErrors[`${integrationPath}.settings.${field.name}`]"
              @update:model-value="editSetting(field.name, $event)"
            />
            <v-select
              v-else-if="field.items"
              :label="field.label" :items="field.items" :disabled="disabled"
              :model-value="integration.settings?.[field.name] ?? settingProperties[field.name]?.defaultTo"
              :hint="field.hint" persistent-hint :error-messages="fieldErrors[`${integrationPath}.settings.${field.name}`]"
              @update:model-value="editSetting(field.name, $event)"
            />
            <v-text-field
              v-else
              :label="field.label" :disabled="disabled" :placeholder="field.placeholder"
              :model-value="integration.settings?.[field.name] ?? settingProperties[field.name]?.defaultTo ?? ''"
              :hint="field.hint" persistent-hint :error-messages="fieldErrors[`${integrationPath}.settings.${field.name}`]"
              @update:model-value="editSetting(field.name, $event)"
            />
          </template>
          <template v-if="['api-key', 'service-account'].includes(integration.authentication.method)">
            <slot name="credential" :reference="integration.authentication.secretRef" :disabled="disabled">
              <v-text-field
                :label="integration.authentication.method === 'service-account' ? provider.serviceAccountReferenceLabel || 'Service-account credential reference' : provider.apiKeyReferenceLabel || 'API key reference'" :model-value="integration.authentication.secretRef" :disabled="disabled"
                :hint="integration.authentication.method === 'service-account' ? provider.serviceAccountReferenceHint || 'Store the service credential in your environment or secret store and enter its reference here.' : provider.apiKeyReferenceHint || 'Store the API key in your environment or secret store. Enter its reference here, such as env:SERVICE_API_KEY.'"
                persistent-hint :error-messages="fieldErrors[`${integrationPath}.authentication.secretRef`]"
                @update:model-value="editSecretReference"
              />
            </slot>
          </template>
          <template v-else-if="integration.authentication.method === 'oauth2'">
            <v-select
              label="App registration" :items="registrationOptions" :model-value="registrationId" :disabled="disabled"
              :error-messages="fieldErrors[`${integrationPath}.authentication.registrationRef`]"
              @update:model-value="editIntegration({ authentication: { ...integration.authentication, registrationRef: $event } })"
            />
            <template v-if="registration?.source === 'own'">
              <v-select
                v-if="grantOptions.length > 1"
                label="OAuth flow" :items="grantOptions" :model-value="grantType" :disabled="disabled"
                :hint="provider.oauthGrantHint" :persistent-hint="Boolean(provider.oauthGrantHint)"
                :error-messages="fieldErrors[`${registrationPath}.grantType`]"
                @update:model-value="editGrantType"
              />
              <v-text-field
                :label="provider.clientIdLabel || 'Client ID'" :hint="provider.clientIdHint" :persistent-hint="Boolean(provider.clientIdHint)" :model-value="registration.clientId" autocomplete="off" :disabled="disabled"
                :error-messages="fieldErrors[`${registrationPath}.clientId`]"
                @update:model-value="editRegistration('clientId', $event)"
              />
              <slot v-if="registration.tokenEndpointAuthMethod !== 'none'" name="credential" :reference="registration.clientSecretRef" :disabled="disabled">
                <v-text-field
                  label="Client secret reference" :model-value="registration.clientSecretRef" :disabled="disabled"
                  hint="Use an environment reference such as env:GOOGLE_CLIENT_SECRET. Keep the value outside this file."
                  persistent-hint :error-messages="fieldErrors[`${registrationPath}.clientSecretRef`]"
                  @update:model-value="editRegistration('clientSecretRef', $event)"
                />
              </slot>
              <v-text-field
                v-if="grantType === 'authorization_code'"
                hint="Reference the callback route implemented by your application and registered with the provider." persistent-hint
                class="mt-4" label="Callback URL reference" :model-value="registration.callbackUrlRef" :disabled="disabled"
                :error-messages="fieldErrors[`${registrationPath}.callbackUrlRef`]"
                @update:model-value="editRegistration('callbackUrlRef', $event)"
              />
              <v-text-field v-if="callbackUrl && grantType === 'authorization_code'" label="Callback URL" :model-value="callbackUrl" readonly />
            </template>
          </template>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel v-if="visibleScopes.length && (provider.scopes.length || provider.permissionsHint || ['oauth2', 'service-account'].includes(integration.authentication.method))" value="permissions" title="Permissions">
        <v-expansion-panel-text>
          <p class="text-body-medium mb-3">{{ provider.permissionsHint || 'Choose what the application needs. The account owner approves these permissions when connecting.' }}</p>
          <v-checkbox
            v-for="permission in visibleScopes" :key="permission.value"
            :label="permission.label" :value="permission.value" :model-value="integration.scopes" :disabled="disabled || permission.required"
            hide-details @update:model-value="editIntegration({ scopes: $event })"
          />
          <p v-if="fieldErrors[`${integrationPath}.scopes`]" role="alert" class="text-error text-body-small mt-2">
            {{ fieldErrors[`${integrationPath}.scopes`] }}
          </p>
        </v-expansion-panel-text>
      </v-expansion-panel>
      <v-expansion-panel v-if="provider.assistantActions?.length" value="assistant" title="Assistant permissions">
        <v-expansion-panel-text>
          <p class="text-body-medium mb-3">These choices control assistant actions for this integration. They do not grant access to the provider or replace your application's permissions.</p>
          <v-switch
            label="Allow assistant access" :model-value="integration.assistantPolicy?.enabled ?? true" :disabled="disabled"
            :error-messages="fieldErrors[`${integrationPath}.assistantPolicy.enabled`]"
            @update:model-value="editAssistantPolicy({ enabled: $event })"
          />
          <v-select
            label="Manage all permissions" :items="assistantPermissions" :model-value="integration.assistantPolicy?.defaultPermission || 'ask'"
            :disabled="disabled || integration.assistantPolicy?.enabled === false"
            hint="Changing this sets every assistant action below to the same choice." persistent-hint
            :error-messages="fieldErrors[`${integrationPath}.assistantPolicy.defaultPermission`]"
            @update:model-value="editAssistantPolicy({ defaultPermission: $event, actions: {} })"
          />
          <v-select
            v-for="action in provider.assistantActions" :key="action.value" :label="action.label" :items="assistantPermissions"
            :model-value="integration.assistantPolicy?.actions?.[action.value] || integration.assistantPolicy?.defaultPermission || 'ask'"
            :disabled="disabled || integration.assistantPolicy?.enabled === false"
            :error-messages="fieldErrors[`${integrationPath}.assistantPolicy.actions.${action.value}`]"
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
