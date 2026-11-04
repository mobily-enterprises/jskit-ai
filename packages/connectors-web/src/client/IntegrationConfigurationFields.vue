<script setup>
import { computed, ref } from "vue";
import { getProviderAccountModes, getProviderAuthenticationMethods, getProviderScopes, providerGrantTypes } from "@jskit-ai/connectors-core/shared/configuration";
import { useJskitText } from "./i18n.js";
import { environmentPrefix, useIntegrationConfiguration } from "./useIntegrationConfiguration.js";

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
const jskitText = useJskitText();
const { t, text, formatDate, fieldErrorMessages } = jskitText;
const errors = computed(() => fieldErrorMessages({ fieldErrors: props.fieldErrors, fieldErrorCodes: props.fieldErrorCodes }));
const panels = ref(["details", "credentials"]);
const {
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
} = useIntegrationConfiguration({ props, emit });
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

function settingValue(field) {
  return integration.value.settings?.[field.name] ?? settingProperties.value[field.name]?.defaultTo;
}

// A hint function receives formatDate so dates it shows follow the app's language (none: its own English).
// readable-check: allow method-probe - input validation: a field's hint is text, or a function of the settings
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
