<template>
  <section class="settings-view py-2 py-md-4">
    <v-card class="panel-card" rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="panel-title">Account settings</v-card-title>
        <v-card-subtitle>Global security, profile, preferences, and notification controls.</v-card-subtitle>
        <template #append>
          <v-btn variant="text" color="secondary" @click="goBack">Back</v-btn>
        </template>
      </v-card-item>
      <v-divider />

      <v-card-text class="pt-4">
        <v-alert v-if="loadError" type="error" variant="tonal" class="mb-4">
          {{ loadError }}
        </v-alert>

        <v-tabs v-model="activeTab" color="primary" density="comfortable" class="mb-4">
          <v-tab value="security">Security</v-tab>
          <v-tab value="profile">Profile</v-tab>
          <v-tab value="preferences">Preferences</v-tab>
          <v-tab value="notifications">Notifications</v-tab>
        </v-tabs>

        <v-window v-model="activeTab">
          <v-window-item value="security">
            <v-row>
              <v-col cols="12" md="7">
                <v-card rounded="lg" elevation="0" border>
                  <v-card-item>
                    <v-card-title class="text-subtitle-1">Authentication methods</v-card-title>
                    <v-card-subtitle>Enable, disable, and manage how this account signs in.</v-card-subtitle>
                  </v-card-item>
                  <v-divider />
                  <v-card-text>
                    <div v-if="authMethodItems.length > 0" class="d-flex flex-column ga-3">
                      <div
                        v-for="method in authMethodItems"
                        :key="method.id"
                        class="d-flex flex-wrap align-center justify-space-between ga-3"
                      >
                        <div>
                          <div class="text-body-2 font-weight-medium">{{ method.label }}</div>
                          <div class="text-caption text-medium-emphasis">
                            {{ authMethodStatusText(method) }}
                          </div>
                        </div>

                        <div class="d-flex flex-wrap justify-end ga-2">
                          <template v-if="method.kind === AUTH_METHOD_KIND_PASSWORD">
                            <v-btn
                              v-if="method.enabled || !method.configured"
                              variant="text"
                              color="secondary"
                              @click="openPasswordForm"
                            >
                              {{ passwordManageLabel }}
                            </v-btn>
                            <v-btn
                              v-if="method.enabled"
                              variant="text"
                              color="error"
                              :disabled="!method.canDisable"
                              :loading="
                                methodActionLoadingId === method.id && setPasswordMethodEnabledMutation.isPending.value
                              "
                              @click="submitPasswordMethodToggle(false)"
                            >
                              Disable
                            </v-btn>
                            <v-btn
                              v-else-if="method.configured"
                              variant="tonal"
                              color="secondary"
                              :disabled="!method.canEnable"
                              @click="openPasswordEnableSetup"
                            >
                              Enable
                            </v-btn>
                          </template>

                          <template v-else-if="method.kind === AUTH_METHOD_KIND_OAUTH">
                            <v-btn
                              v-if="method.enabled"
                              variant="text"
                              color="error"
                              :disabled="!method.canDisable"
                              :loading="methodActionLoadingId === method.id && unlinkProviderMutation.isPending.value"
                              @click="submitProviderUnlink(method.provider)"
                            >
                              Unlink
                            </v-btn>
                            <v-btn
                              v-else
                              variant="tonal"
                              color="secondary"
                              :disabled="providerLinkStartInFlight"
                              @click="startProviderLink(method.provider)"
                            >
                              Link
                            </v-btn>
                          </template>

                          <template v-else-if="method.kind === AUTH_METHOD_KIND_OTP">
                            <v-chip size="small" label color="secondary">Required</v-chip>
                          </template>
                        </div>
                      </div>
                    </div>
                    <p v-else class="text-body-2 text-medium-emphasis mb-0">
                      No user-managed sign-in methods are available yet.
                    </p>

                    <p class="text-caption text-medium-emphasis mt-3 mb-0">{{ securityMethodsHint }}</p>

                    <v-alert v-if="providerMessage" :type="providerMessageType" variant="tonal" class="mt-3 mb-0">
                      {{ providerMessage }}
                    </v-alert>

                    <v-dialog v-model="showPasswordForm" max-width="560">
                      <v-card rounded="lg" border>
                        <v-card-item>
                          <v-card-title class="text-subtitle-1">{{ passwordDialogTitle }}</v-card-title>
                          <v-card-subtitle v-if="isPasswordEnableSetupMode">
                            Set a new password, then click Enable to turn password sign-in on.
                          </v-card-subtitle>
                        </v-card-item>
                        <v-divider />
                        <v-card-text>
                          <v-form @submit.prevent="submitPasswordChange" novalidate>
                            <v-text-field
                              v-if="requiresCurrentPassword"
                              v-model="securityForm.currentPassword"
                              label="Current password"
                              :type="showCurrentPassword ? 'text' : 'password'"
                              :append-inner-icon="showCurrentPassword ? 'mdi-eye-off' : 'mdi-eye'"
                              @click:append-inner="showCurrentPassword = !showCurrentPassword"
                              variant="outlined"
                              density="comfortable"
                              autocomplete="current-password"
                              :error-messages="securityFieldErrors.currentPassword ? [securityFieldErrors.currentPassword] : []"
                              class="mb-3"
                            />

                            <v-text-field
                              v-model="securityForm.newPassword"
                              label="New password"
                              :type="showNewPassword ? 'text' : 'password'"
                              :append-inner-icon="showNewPassword ? 'mdi-eye-off' : 'mdi-eye'"
                              @click:append-inner="showNewPassword = !showNewPassword"
                              variant="outlined"
                              density="comfortable"
                              autocomplete="new-password"
                              :error-messages="securityFieldErrors.newPassword ? [securityFieldErrors.newPassword] : []"
                              class="mb-3"
                            />

                            <v-text-field
                              v-model="securityForm.confirmPassword"
                              label="Confirm new password"
                              :type="showConfirmPassword ? 'text' : 'password'"
                              :append-inner-icon="showConfirmPassword ? 'mdi-eye-off' : 'mdi-eye'"
                              @click:append-inner="showConfirmPassword = !showConfirmPassword"
                              variant="outlined"
                              density="comfortable"
                              autocomplete="new-password"
                              :error-messages="securityFieldErrors.confirmPassword ? [securityFieldErrors.confirmPassword] : []"
                              class="mb-3"
                            />

                            <v-alert v-if="securityMessage" :type="securityMessageType" variant="tonal" class="mb-3">
                              {{ securityMessage }}
                            </v-alert>

                            <div class="d-flex flex-wrap ga-2">
                              <v-btn type="submit" color="primary" :loading="passwordFormSubmitPending">
                                {{ passwordFormSubmitLabel }}
                              </v-btn>
                              <v-btn variant="text" color="secondary" @click="closePasswordForm">Cancel</v-btn>
                            </div>
                          </v-form>
                        </v-card-text>
                      </v-card>
                    </v-dialog>
                  </v-card-text>
                </v-card>
              </v-col>

              <v-col cols="12" md="5">
                <v-card rounded="lg" elevation="0" border class="mb-4">
                  <v-card-item>
                    <v-card-title class="text-subtitle-1">Active sessions</v-card-title>
                  </v-card-item>
                  <v-divider />
                  <v-card-text>
                    <p class="text-body-2 text-medium-emphasis mb-3">
                      Sign out all other devices while keeping this session active.
                    </p>

                    <v-btn
                      color="secondary"
                      variant="outlined"
                      :loading="logoutOthersMutation.isPending.value"
                      @click="submitLogoutOthers"
                    >
                      Sign out other devices
                    </v-btn>

                    <v-alert v-if="sessionsMessage" :type="sessionsMessageType" variant="tonal" class="mt-3 mb-0">
                      {{ sessionsMessage }}
                    </v-alert>
                  </v-card-text>
                </v-card>

                <v-card rounded="lg" elevation="0" border>
                  <v-card-item>
                    <v-card-title class="text-subtitle-1">MFA status</v-card-title>
                  </v-card-item>
                  <v-divider />
                  <v-card-text>
                    <v-chip :color="mfaChipColor" label>{{ mfaLabel }}</v-chip>
                    <p class="text-body-2 text-medium-emphasis mt-3 mb-0">
                      Multi-factor enrollment UI is scaffolded as read-only in this version.
                    </p>
                  </v-card-text>
                </v-card>
              </v-col>
            </v-row>
          </v-window-item>

          <v-window-item value="profile">
            <v-card rounded="lg" elevation="0" border>
              <v-card-item>
                <v-card-title class="text-subtitle-1">Profile</v-card-title>
              </v-card-item>
              <v-divider />
              <v-card-text>
                <v-form @submit.prevent="submitProfile" novalidate>
                  <v-row class="mb-2">
                    <v-col cols="12" md="4" class="d-flex flex-column align-center justify-center">
                      <v-avatar :size="preferencesForm.avatarSize" color="surface-variant" rounded="circle" class="mb-3">
                        <v-img v-if="profileAvatar.effectiveUrl" :src="profileAvatar.effectiveUrl" cover />
                        <span v-else class="text-h6">{{ profileInitials }}</span>
                      </v-avatar>
                      <div class="text-caption text-medium-emphasis">Preview size: {{ preferencesForm.avatarSize }} px</div>
                    </v-col>
                    <v-col cols="12" md="8">
                      <div class="d-flex flex-wrap ga-2 mb-2">
                        <v-btn variant="tonal" color="secondary" @click="openAvatarEditor">Replace avatar</v-btn>
                        <v-btn
                          v-if="profileAvatar.hasUploadedAvatar"
                          variant="text"
                          color="error"
                          :loading="avatarDeleteMutation.isPending.value"
                          @click="submitAvatarDelete"
                        >
                          Remove avatar
                        </v-btn>
                      </div>
                      <div v-if="selectedAvatarFileName" class="text-caption text-medium-emphasis mb-2">
                        Selected file: {{ selectedAvatarFileName }}
                      </div>

                      <v-alert v-if="avatarMessage" :type="avatarMessageType" variant="tonal" class="mb-0">
                        {{ avatarMessage }}
                      </v-alert>
                    </v-col>
                  </v-row>

                  <v-row>
                    <v-col cols="12" md="6">
                      <v-text-field
                        v-model="profileForm.displayName"
                        label="Display name"
                        variant="outlined"
                        density="comfortable"
                        autocomplete="nickname"
                        :error-messages="profileFieldErrors.displayName ? [profileFieldErrors.displayName] : []"
                      />
                    </v-col>
                    <v-col cols="12" md="6">
                      <v-text-field
                        v-model="profileForm.email"
                        label="Email"
                        variant="outlined"
                        density="comfortable"
                        readonly
                        hint="Managed by Supabase Auth"
                        persistent-hint
                      />
                    </v-col>
                  </v-row>

                  <v-alert v-if="profileMessage" :type="profileMessageType" variant="tonal" class="mb-3">
                    {{ profileMessage }}
                  </v-alert>

                  <v-btn type="submit" color="primary" :loading="profileMutation.isPending.value">Save profile</v-btn>
                </v-form>
              </v-card-text>
            </v-card>
          </v-window-item>

          <v-window-item value="preferences">
            <v-card rounded="lg" elevation="0" border>
              <v-card-item>
                <v-card-title class="text-subtitle-1">Preferences</v-card-title>
              </v-card-item>
              <v-divider />
              <v-card-text>
                <v-form @submit.prevent="submitPreferences" novalidate>
                  <v-row>
                    <v-col cols="12" md="4">
                      <v-select
                        v-model="preferencesForm.theme"
                        label="Theme"
                        :items="themeOptions"
                        item-title="title"
                        item-value="value"
                        variant="outlined"
                        density="comfortable"
                        :error-messages="preferencesFieldErrors.theme ? [preferencesFieldErrors.theme] : []"
                      />
                    </v-col>
                    <v-col cols="12" md="4">
                      <v-select
                        v-model="preferencesForm.locale"
                        label="Language / locale"
                        :items="localeOptions"
                        item-title="title"
                        item-value="value"
                        variant="outlined"
                        density="comfortable"
                        :error-messages="preferencesFieldErrors.locale ? [preferencesFieldErrors.locale] : []"
                      />
                    </v-col>
                    <v-col cols="12" md="4">
                      <v-select
                        v-model="preferencesForm.timeZone"
                        label="Time zone"
                        :items="timeZoneOptions"
                        variant="outlined"
                        density="comfortable"
                        :error-messages="preferencesFieldErrors.timeZone ? [preferencesFieldErrors.timeZone] : []"
                      />
                    </v-col>

                    <v-col cols="12" md="4">
                      <v-select
                        v-model="preferencesForm.dateFormat"
                        label="Date format"
                        :items="dateFormatOptions"
                        item-title="title"
                        item-value="value"
                        variant="outlined"
                        density="comfortable"
                        :error-messages="preferencesFieldErrors.dateFormat ? [preferencesFieldErrors.dateFormat] : []"
                      />
                    </v-col>
                    <v-col cols="12" md="4">
                      <v-select
                        v-model="preferencesForm.numberFormat"
                        label="Number format"
                        :items="numberFormatOptions"
                        item-title="title"
                        item-value="value"
                        variant="outlined"
                        density="comfortable"
                        :error-messages="preferencesFieldErrors.numberFormat ? [preferencesFieldErrors.numberFormat] : []"
                      />
                    </v-col>
                    <v-col cols="12" md="4">
                      <v-select
                        v-model="preferencesForm.currencyCode"
                        label="Currency"
                        :items="currencyOptions"
                        variant="outlined"
                        density="comfortable"
                        :error-messages="preferencesFieldErrors.currencyCode ? [preferencesFieldErrors.currencyCode] : []"
                      />
                    </v-col>
                    <v-col cols="12" md="3">
                      <v-select
                        v-model.number="preferencesForm.avatarSize"
                        label="Avatar size"
                        :items="avatarSizeOptions"
                        variant="outlined"
                        density="comfortable"
                        :error-messages="preferencesFieldErrors.avatarSize ? [preferencesFieldErrors.avatarSize] : []"
                      />
                    </v-col>
                  </v-row>

                  <v-alert v-if="preferencesMessage" :type="preferencesMessageType" variant="tonal" class="mb-3">
                    {{ preferencesMessage }}
                  </v-alert>

                  <v-btn type="submit" color="primary" :loading="preferencesMutation.isPending.value">Save preferences</v-btn>
                </v-form>
              </v-card-text>
            </v-card>
          </v-window-item>

          <v-window-item value="notifications">
            <v-card rounded="lg" elevation="0" border>
              <v-card-item>
                <v-card-title class="text-subtitle-1">Notifications</v-card-title>
              </v-card-item>
              <v-divider />
              <v-card-text>
                <v-form @submit.prevent="submitNotifications" novalidate>
                  <v-switch
                    v-model="notificationsForm.productUpdates"
                    label="Product updates"
                    color="primary"
                    hide-details
                    class="mb-2"
                  />
                  <v-switch
                    v-model="notificationsForm.accountActivity"
                    label="Account activity alerts"
                    color="primary"
                    hide-details
                    class="mb-2"
                  />
                  <v-switch
                    v-model="notificationsForm.securityAlerts"
                    label="Security alerts (required)"
                    color="primary"
                    hide-details
                    disabled
                    class="mb-4"
                  />

                  <v-alert v-if="notificationsMessage" :type="notificationsMessageType" variant="tonal" class="mb-3">
                    {{ notificationsMessage }}
                  </v-alert>

                  <v-btn type="submit" color="primary" :loading="notificationsMutation.isPending.value">
                    Save notification settings
                  </v-btn>
                </v-form>
              </v-card-text>
            </v-card>
          </v-window-item>
        </v-window>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { computed, markRaw, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useTheme } from "vuetify";
import Uppy from "@uppy/core";
import Dashboard from "@uppy/dashboard";
import ImageEditor from "@uppy/image-editor";
import Compressor from "@uppy/compressor";
import XHRUpload from "@uppy/xhr-upload";
import "@uppy/core/css/style.min.css";
import "@uppy/dashboard/css/style.min.css";
import "@uppy/image-editor/css/style.min.css";
import { resolveSurfacePaths } from "../../shared/routing/surfacePaths.js";
import { api } from "../services/api";
import { useAuthStore } from "../stores/authStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useAuthGuard } from "../composables/useAuthGuard";
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_DEFAULT_SIZE,
  AVATAR_MAX_UPLOAD_BYTES,
  AVATAR_SIZE_OPTIONS
} from "../../shared/avatar/index.js";
import {
  AUTH_METHOD_DEFINITIONS,
  AUTH_METHOD_KIND_OAUTH,
  AUTH_METHOD_KIND_OTP,
  AUTH_METHOD_KIND_PASSWORD,
  AUTH_METHOD_PASSWORD_ID,
  buildOAuthMethodId
} from "../../shared/auth/authMethods.js";
import { AUTH_OAUTH_PROVIDER_METADATA, normalizeOAuthProvider } from "../../shared/auth/oauthProviders.js";
import {
  clearPendingOAuthContext,
  readOAuthCallbackStateFromLocation,
  readPendingOAuthContext,
  stripOAuthCallbackParamsFromLocation,
  writePendingOAuthContext
} from "../utils/oauthCallback.js";

const SETTINGS_QUERY_KEY = ["settings"];
const VALID_TABS = new Set(["security", "profile", "preferences", "notifications"]);
const PASSWORD_FORM_MODE_MANAGE = "manage";
const PASSWORD_FORM_MODE_ENABLE = "enable";

const themeOptions = [
  { title: "System", value: "system" },
  { title: "Light", value: "light" },
  { title: "Dark", value: "dark" }
];
const localeOptions = [
  { title: "English (US)", value: "en-US" },
  { title: "English (UK)", value: "en-GB" },
  { title: "Italian", value: "it-IT" },
  { title: "Spanish", value: "es-ES" }
];
const dateFormatOptions = [
  { title: "System", value: "system" },
  { title: "MM/DD/YYYY", value: "mdy" },
  { title: "DD/MM/YYYY", value: "dmy" },
  { title: "YYYY-MM-DD", value: "ymd" }
];
const numberFormatOptions = [
  { title: "System", value: "system" },
  { title: "1,234.56", value: "comma-dot" },
  { title: "1.234,56", value: "dot-comma" },
  { title: "1 234,56", value: "space-comma" }
];
const currencyOptions = ["USD", "EUR", "GBP", "AUD", "JPY"];
const timeZoneOptions = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Rome",
  "Asia/Tokyo",
  "Australia/Sydney"
];
const avatarSizeOptions = [...AVATAR_SIZE_OPTIONS];

function createDefaultAvatar() {
  return {
    uploadedUrl: null,
    gravatarUrl: "",
    effectiveUrl: "",
    hasUploadedAvatar: false,
    size: AVATAR_DEFAULT_SIZE,
    version: null
  };
}

const navigate = useNavigate();
const authStore = useAuthStore();
const workspaceStore = useWorkspaceStore();
const queryClient = useQueryClient();
const vuetifyTheme = useTheme();
const { handleUnauthorizedError } = useAuthGuard();

const routerSearch = useRouterState({
  select: (state) => state.location.search
});
const routerPath = useRouterState({
  select: (state) => state.location.pathname
});
const surfacePaths = computed(() => resolveSurfacePaths(routerPath.value));

const activeTab = ref("preferences");
const syncingTabFromUrl = ref(false);
const settingsEnabled = ref(false);
const loadError = ref("");

const profileForm = reactive({
  displayName: "",
  email: ""
});
const profileAvatar = reactive(createDefaultAvatar());
const selectedAvatarFileName = ref("");
const avatarUppy = shallowRef(null);

const preferencesForm = reactive({
  theme: "system",
  locale: "en-US",
  timeZone: "UTC",
  dateFormat: "system",
  numberFormat: "system",
  currencyCode: "USD",
  avatarSize: AVATAR_DEFAULT_SIZE
});

const notificationsForm = reactive({
  productUpdates: true,
  accountActivity: true,
  securityAlerts: true
});

const securityForm = reactive({
  currentPassword: "",
  newPassword: "",
  confirmPassword: ""
});

const profileFieldErrors = reactive({
  displayName: ""
});
const preferencesFieldErrors = reactive({
  theme: "",
  locale: "",
  timeZone: "",
  dateFormat: "",
  numberFormat: "",
  currencyCode: "",
  avatarSize: ""
});
const securityFieldErrors = reactive({
  currentPassword: "",
  newPassword: "",
  confirmPassword: ""
});

const profileMessage = ref("");
const profileMessageType = ref("success");
const avatarMessage = ref("");
const avatarMessageType = ref("success");
const preferencesMessage = ref("");
const preferencesMessageType = ref("success");
const notificationsMessage = ref("");
const notificationsMessageType = ref("success");
const securityMessage = ref("");
const securityMessageType = ref("success");
const sessionsMessage = ref("");
const sessionsMessageType = ref("success");
const providerMessage = ref("");
const providerMessageType = ref("success");
const providerLinkStartInFlight = ref(false);
const methodActionLoadingId = ref("");
const showPasswordForm = ref(false);
const passwordFormMode = ref(PASSWORD_FORM_MODE_MANAGE);

const showCurrentPassword = ref(false);
const showNewPassword = ref(false);
const showConfirmPassword = ref(false);

const settingsQuery = useQuery({
  queryKey: SETTINGS_QUERY_KEY,
  queryFn: () => api.settings(),
  enabled: settingsEnabled
});

const profileMutation = useMutation({
  mutationFn: (payload) => api.updateProfileSettings(payload)
});

const avatarDeleteMutation = useMutation({
  mutationFn: () => api.deleteProfileAvatar()
});

const preferencesMutation = useMutation({
  mutationFn: (payload) => api.updatePreferencesSettings(payload)
});

const notificationsMutation = useMutation({
  mutationFn: (payload) => api.updateNotificationSettings(payload)
});

const passwordMutation = useMutation({
  mutationFn: (payload) => api.changePassword(payload)
});

const setPasswordMethodEnabledMutation = useMutation({
  mutationFn: (payload) => api.setPasswordMethodEnabled(payload)
});

const logoutOthersMutation = useMutation({
  mutationFn: () => api.logoutOtherSessions()
});

const unlinkProviderMutation = useMutation({
  mutationFn: (providerId) => api.unlinkSettingsOAuthProvider(providerId)
});

const mfaStatus = computed(() => String(settingsQuery.data.value?.security?.mfa?.status || "not_enabled"));
const securityStatus = computed(() => {
  const security = settingsQuery.data.value?.security;
  return security && typeof security === "object" ? security : {};
});

function createFallbackAuthMethods() {
  return AUTH_METHOD_DEFINITIONS.map((definition) => {
    const alwaysAvailable = definition.kind === AUTH_METHOD_KIND_OTP;
    return {
      id: definition.id,
      kind: definition.kind,
      provider: definition.provider || null,
      label: definition.label,
      configured: alwaysAvailable,
      enabled: alwaysAvailable,
      canEnable: false,
      canDisable: false,
      supportsSecretUpdate: Boolean(definition.supportsSecretUpdate),
      requiresCurrentPassword: false
    };
  });
}

function normalizeAuthMethod(rawMethod) {
  const method = rawMethod && typeof rawMethod === "object" ? rawMethod : {};
  const id = String(method.id || "");
  const kind = String(method.kind || "");

  return {
    id,
    kind,
    provider: method.provider == null ? null : String(method.provider || ""),
    label: String(method.label || id || "Method"),
    configured: Boolean(method.configured),
    enabled: Boolean(method.enabled),
    canEnable: Boolean(method.canEnable),
    canDisable: Boolean(method.canDisable),
    supportsSecretUpdate: Boolean(method.supportsSecretUpdate),
    requiresCurrentPassword: Boolean(method.requiresCurrentPassword)
  };
}

const securityAuthPolicy = computed(() => {
  const authPolicy = securityStatus.value?.authPolicy;
  if (!authPolicy || typeof authPolicy !== "object") {
    return {
      minimumEnabledMethods: 1,
      enabledMethodsCount: 0
    };
  }

  return {
    minimumEnabledMethods: Number.isInteger(Number(authPolicy.minimumEnabledMethods))
      ? Math.max(1, Number(authPolicy.minimumEnabledMethods))
      : 1,
    enabledMethodsCount: Number.isInteger(Number(authPolicy.enabledMethodsCount))
      ? Math.max(0, Number(authPolicy.enabledMethodsCount))
      : 0
  };
});

const securityAuthMethods = computed(() => {
  const methods = securityStatus.value?.authMethods;
  if (!Array.isArray(methods) || methods.length === 0) {
    return createFallbackAuthMethods();
  }

  return methods.map(normalizeAuthMethod).filter((method) => method.id);
});

const passwordMethod = computed(
  () =>
    securityAuthMethods.value.find((method) => String(method.id || "") === AUTH_METHOD_PASSWORD_ID) || {
      id: AUTH_METHOD_PASSWORD_ID,
      kind: AUTH_METHOD_KIND_PASSWORD,
      provider: "email",
      label: "Password",
      configured: false,
      enabled: false,
      canEnable: false,
      canDisable: false,
      supportsSecretUpdate: true,
      requiresCurrentPassword: false
    }
);

const isPasswordEnableSetupMode = computed(() => passwordFormMode.value === PASSWORD_FORM_MODE_ENABLE);
const requiresCurrentPassword = computed(() => Boolean(passwordMethod.value.requiresCurrentPassword));
const canOpenPasswordManageForm = computed(() => Boolean(passwordMethod.value.enabled || !passwordMethod.value.configured));
const canOpenPasswordEnableSetup = computed(
  () => Boolean(passwordMethod.value.configured && !passwordMethod.value.enabled && passwordMethod.value.canEnable)
);
const canSubmitPasswordForm = computed(() =>
  isPasswordEnableSetupMode.value ? canOpenPasswordEnableSetup.value : canOpenPasswordManageForm.value
);
const passwordRequiresExistingSecret = computed(
  () => Boolean(passwordMethod.value.enabled && passwordMethod.value.requiresCurrentPassword)
);
const passwordSubmitLabel = computed(() => (passwordRequiresExistingSecret.value ? "Update password" : "Set password"));
const passwordManageLabel = computed(() => (passwordRequiresExistingSecret.value ? "Change password" : "Set password"));
const passwordDialogTitle = computed(() =>
  isPasswordEnableSetupMode.value ? "Enable password sign-in" : passwordManageLabel.value
);
const passwordFormSubmitLabel = computed(() => (isPasswordEnableSetupMode.value ? "Enable" : passwordSubmitLabel.value));
const passwordFormSubmitPending = computed(
  () => passwordMutation.isPending.value || setPasswordMethodEnabledMutation.isPending.value
);
const authMethodItems = computed(() =>
  securityAuthMethods.value.filter((method) => method.kind !== AUTH_METHOD_KIND_OTP)
);
const securityMethodsHint = computed(() => {
  const minimum = securityAuthPolicy.value.minimumEnabledMethods;
  if (minimum <= 1) {
    return "At least one sign-in method must remain enabled.";
  }

  return `At least ${minimum} sign-in methods must remain enabled.`;
});
const mfaLabel = computed(() => {
  if (mfaStatus.value === "enabled") {
    return "MFA enabled";
  }
  return "MFA not enabled";
});
const mfaChipColor = computed(() => {
  if (mfaStatus.value === "enabled") {
    return "primary";
  }
  return "secondary";
});
const profileInitials = computed(() => {
  const source = String(profileForm.displayName || authStore.username || "U").trim();
  return source.slice(0, 2).toUpperCase();
});

function resolveTabFromSearch(search) {
  const tab = String(search?.tab || "").trim().toLowerCase();
  return VALID_TABS.has(tab) ? tab : "preferences";
}

function isSettingsRoutePath(pathname) {
  return surfacePaths.value.isAccountSettingsPath(pathname);
}

function resolveCurrentSettingsPath() {
  return isSettingsRoutePath(routerPath.value) ? String(routerPath.value) : "";
}

function resolveSettingsSearchWithTab(tab) {
  const search = {
    tab
  };

  const returnTo = String(routerSearch.value?.returnTo || "").trim();
  if (returnTo) {
    search.returnTo = returnTo;
  }

  return search;
}

function buildSettingsPathWithTab(tab) {
  const settingsPath = resolveCurrentSettingsPath() || surfacePaths.value.accountSettingsPath;
  const params = new URLSearchParams(resolveSettingsSearchWithTab(tab));
  return `${settingsPath}?${params.toString()}`;
}

const backTarget = computed(() => {
  const currentSurfacePaths = surfacePaths.value;
  const rawReturnTo = String(routerSearch.value?.returnTo || "").trim();
  if (
    /^\/(?!\/)/.test(rawReturnTo) &&
    rawReturnTo !== currentSurfacePaths.accountSettingsPath &&
    !currentSurfacePaths.isAccountSettingsPath(rawReturnTo)
  ) {
    return rawReturnTo;
  }

  if (workspaceStore.hasActiveWorkspace) {
    return workspaceStore.workspacePath("/", { surface: currentSurfacePaths.surface });
  }

  return currentSurfacePaths.workspacesPath;
});

function clearFieldErrors(target) {
  for (const key of Object.keys(target)) {
    target[key] = "";
  }
}

function toErrorMessage(error, fallback) {
  if (error?.fieldErrors && typeof error.fieldErrors === "object") {
    const details = Array.from(
      new Set(
        Object.values(error.fieldErrors)
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      )
    );
    if (details.length > 0) {
      return details.join(" ");
    }
  }

  return String(error?.message || fallback);
}

function providerLabel(providerId) {
  const normalized = normalizeOAuthProvider(providerId, { fallback: null });
  if (!normalized) {
    return String(providerId || "Provider");
  }

  return String(AUTH_OAUTH_PROVIDER_METADATA[normalized]?.label || normalized);
}

function authMethodStatusText(method) {
  const normalized = method && typeof method === "object" ? method : {};
  if (normalized.kind === AUTH_METHOD_KIND_OTP) {
    return "Always available";
  }
  if (normalized.kind === AUTH_METHOD_KIND_OAUTH) {
    return normalized.enabled ? "Linked" : "Not linked";
  }

  if (normalized.enabled) {
    return "Enabled";
  }
  if (normalized.configured) {
    return "Configured but disabled";
  }

  return "Not configured";
}

async function handleOAuthCallbackIfPresent() {
  const pendingOAuthContext = readPendingOAuthContext();
  const callbackState = readOAuthCallbackStateFromLocation({
    pendingContext: pendingOAuthContext,
    defaultIntent: "link",
    defaultReturnTo: buildSettingsPathWithTab("security")
  });

  if (!callbackState) {
    return;
  }

  providerMessage.value = "";
  providerLinkStartInFlight.value = true;

  try {
    await api.oauthComplete(callbackState.payload);
    const session = await authStore.refreshSession();
    if (!session?.authenticated) {
      throw new Error("Provider link succeeded but the active session is unavailable. Please retry.");
    }

    stripOAuthCallbackParamsFromLocation({
      preserveSearchKeys: ["tab", "returnTo"]
    });
    await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });

    providerMessageType.value = "success";
    providerMessage.value =
      callbackState.intent === "link"
        ? `${providerLabel(callbackState.provider)} linked.`
        : "Sign-in completed.";
  } catch (error) {
    if (await handleAuthError(error)) {
      return;
    }

    providerMessageType.value = "error";
    providerMessage.value = toErrorMessage(error, "Unable to complete provider link.");
    stripOAuthCallbackParamsFromLocation({
      preserveSearchKeys: ["tab", "returnTo"]
    });
  } finally {
    clearPendingOAuthContext();
    providerLinkStartInFlight.value = false;
  }
}

function applyAvatarData(avatar) {
  const nextAvatar = avatar && typeof avatar === "object" ? avatar : {};

  profileAvatar.uploadedUrl = nextAvatar.uploadedUrl ? String(nextAvatar.uploadedUrl) : null;
  profileAvatar.gravatarUrl = String(nextAvatar.gravatarUrl || "");
  profileAvatar.effectiveUrl = String(nextAvatar.effectiveUrl || profileAvatar.gravatarUrl || "");
  profileAvatar.hasUploadedAvatar = Boolean(nextAvatar.hasUploadedAvatar);
  profileAvatar.size = Number(nextAvatar.size || preferencesForm.avatarSize || AVATAR_DEFAULT_SIZE);
  profileAvatar.version = nextAvatar.version == null ? null : String(nextAvatar.version);
}

function setupAvatarUploader() {
  if (typeof window === "undefined") {
    return;
  }

  if (import.meta.env.MODE === "test") {
    return;
  }

  if (avatarUppy.value) {
    return;
  }

  const uppy = new Uppy({
    autoProceed: false,
    restrictions: {
      maxNumberOfFiles: 1,
      allowedFileTypes: [...AVATAR_ALLOWED_MIME_TYPES],
      maxFileSize: AVATAR_MAX_UPLOAD_BYTES
    }
  });

  uppy.use(Dashboard, {
    inline: false,
    closeAfterFinish: false,
    showProgressDetails: true,
    proudlyDisplayPoweredByUppy: false,
    hideUploadButton: false,
    doneButtonHandler: () => {
      const dashboard = uppy.getPlugin("Dashboard");
      if (dashboard && typeof dashboard.closeModal === "function") {
        dashboard.closeModal();
      }
    },
    note: `Accepted: ${AVATAR_ALLOWED_MIME_TYPES.join(", ")}, max ${Math.floor(AVATAR_MAX_UPLOAD_BYTES / (1024 * 1024))}MB`
  });
  uppy.use(ImageEditor, {
    quality: 0.9
  });
  uppy.use(Compressor, {
    quality: 0.84,
    limit: 1
  });
  uppy.use(XHRUpload, {
    endpoint: "/api/settings/profile/avatar",
    method: "POST",
    formData: true,
    fieldName: "avatar",
    withCredentials: true,
    onBeforeRequest: async (xhr) => {
      const session = await api.session();
      const csrfToken = String(session?.csrfToken || "");
      if (!csrfToken) {
        throw new Error("Unable to prepare secure avatar upload request.");
      }
      xhr.setRequestHeader("csrf-token", csrfToken);
    },
    getResponseData: (xhr) => {
      if (!xhr.responseText) {
        return {};
      }

      try {
        return JSON.parse(xhr.responseText);
      } catch {
        return {};
      }
    }
  });

  uppy.on("file-added", (file) => {
    selectedAvatarFileName.value = String(file?.name || "");
  });
  uppy.on("file-removed", () => {
    selectedAvatarFileName.value = "";
  });
  uppy.on("file-editor:complete", (file) => {
    selectedAvatarFileName.value = String(file?.name || selectedAvatarFileName.value || "");
    const imageEditor = uppy.getPlugin("ImageEditor");
    if (imageEditor && typeof imageEditor.stop === "function") {
      imageEditor.stop();
    }
  });
  uppy.on("file-editor:cancel", () => {
    const imageEditor = uppy.getPlugin("ImageEditor");
    if (imageEditor && typeof imageEditor.stop === "function") {
      imageEditor.stop();
    }
  });
  uppy.on("dashboard:modal-closed", () => {
    const imageEditor = uppy.getPlugin("ImageEditor");
    if (imageEditor && typeof imageEditor.stop === "function") {
      imageEditor.stop();
    }
  });
  uppy.on("upload-success", (_file, response) => {
    const data = response?.body;
    if (!data || typeof data !== "object") {
      avatarMessageType.value = "error";
      avatarMessage.value = "Avatar uploaded, but the response payload was invalid.";
      return;
    }

    queryClient.setQueryData(SETTINGS_QUERY_KEY, data);
    applySettingsData(data);

    const dashboard = uppy.getPlugin("Dashboard");
    if (dashboard && typeof dashboard.closeModal === "function") {
      dashboard.closeModal();
    }

    avatarMessageType.value = "success";
    avatarMessage.value = "Avatar uploaded.";
    selectedAvatarFileName.value = "";
  });
  uppy.on("upload-error", (_file, error, response) => {
    const status = Number(response?.status || 0);
    const body = response?.body && typeof response.body === "object" ? response.body : {};
    const fieldErrors =
      body?.fieldErrors && typeof body.fieldErrors === "object"
        ? body.fieldErrors
        : body?.details?.fieldErrors && typeof body.details.fieldErrors === "object"
          ? body.details.fieldErrors
          : {};

    if (status === 401) {
      void handleAuthError({
        status,
        message: String(body?.error || error?.message || "Authentication required.")
      });
      return;
    }

    avatarMessageType.value = "error";
    avatarMessage.value = String(
      fieldErrors.avatar ||
        body?.error ||
        error?.message ||
        "Unable to upload avatar."
    );
  });
  uppy.on("restriction-failed", (_file, error) => {
    avatarMessageType.value = "error";
    avatarMessage.value = String(error?.message || "Selected avatar file does not meet upload restrictions.");
  });
  uppy.on("complete", (result) => {
    const successfulCount = Array.isArray(result?.successful) ? result.successful.length : 0;
    if (successfulCount <= 0) {
      return;
    }

    try {
      uppy.clear();
    } catch {
      // Ignore non-critical clear timing issues; upload already succeeded.
    }
  });

  avatarUppy.value = markRaw(uppy);
}

function applyThemePreference(themePreference) {
  const preference = String(themePreference || "system").toLowerCase();
  if (preference === "dark") {
    vuetifyTheme.global.name.value = "dark";
    return;
  }
  if (preference === "light") {
    vuetifyTheme.global.name.value = "light";
    return;
  }

  const prefersDark =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false;
  vuetifyTheme.global.name.value = prefersDark ? "dark" : "light";
}

function applySettingsData(data) {
  if (!data || typeof data !== "object") {
    return;
  }

  profileForm.displayName = String(data.profile?.displayName || "");
  profileForm.email = String(data.profile?.email || "");
  applyAvatarData(data.profile?.avatar);
  authStore.setUsername(profileForm.displayName || null);
  workspaceStore.applyProfile({
    displayName: profileForm.displayName,
    email: profileForm.email,
    avatar: { ...profileAvatar }
  });

  preferencesForm.theme = String(data.preferences?.theme || "system");
  preferencesForm.locale = String(data.preferences?.locale || "en-US");
  preferencesForm.timeZone = String(data.preferences?.timeZone || "UTC");
  preferencesForm.dateFormat = String(data.preferences?.dateFormat || "system");
  preferencesForm.numberFormat = String(data.preferences?.numberFormat || "system");
  preferencesForm.currencyCode = String(data.preferences?.currencyCode || "USD");
  preferencesForm.avatarSize = Number(data.preferences?.avatarSize || AVATAR_DEFAULT_SIZE);
  profileAvatar.size = preferencesForm.avatarSize;

  notificationsForm.productUpdates = Boolean(data.notifications?.productUpdates);
  notificationsForm.accountActivity = Boolean(data.notifications?.accountActivity);
  notificationsForm.securityAlerts = true;

  applyThemePreference(preferencesForm.theme);
}

async function handleAuthError(error) {
  return handleUnauthorizedError(error);
}

watch(
  () => settingsQuery.error.value,
  async (error) => {
    if (!error) {
      loadError.value = "";
      return;
    }

    if (await handleAuthError(error)) {
      return;
    }

    loadError.value = toErrorMessage(error, "Unable to load settings.");
  }
);

watch(
  () => settingsQuery.data.value,
  (data) => {
    if (!data) {
      return;
    }

    loadError.value = "";
    applySettingsData(data);
  },
  { immediate: true }
);

watch(
  () => [
    passwordMethod.value.configured,
    passwordMethod.value.enabled,
    passwordMethod.value.canEnable,
    passwordFormMode.value
  ],
  () => {
    if (!canSubmitPasswordForm.value && showPasswordForm.value) {
      closePasswordForm();
    }
  }
);

watch(
  () => routerSearch.value,
  (search) => {
    if (!isSettingsRoutePath(routerPath.value)) {
      return;
    }

    const nextTab = resolveTabFromSearch(search);
    if (activeTab.value === nextTab) {
      return;
    }

    syncingTabFromUrl.value = true;
    activeTab.value = nextTab;
    syncingTabFromUrl.value = false;
  },
  { immediate: true }
);

watch(activeTab, async (nextTab) => {
  if (!VALID_TABS.has(nextTab)) {
    return;
  }
  if (!isSettingsRoutePath(routerPath.value)) {
    return;
  }
  if (syncingTabFromUrl.value) {
    return;
  }
  if (resolveTabFromSearch(routerSearch.value) === nextTab) {
    return;
  }

  await navigate({
    to: routerPath.value,
    search: resolveSettingsSearchWithTab(nextTab),
    replace: true
  });
});

async function goBack() {
  await navigate({
    to: backTarget.value
  });
}

async function submitProfile() {
  clearFieldErrors(profileFieldErrors);
  profileMessage.value = "";

  try {
    const data = await profileMutation.mutateAsync({
      displayName: profileForm.displayName
    });

    queryClient.setQueryData(SETTINGS_QUERY_KEY, data);
    applySettingsData(data);
    authStore.setUsername(data.profile?.displayName || null);
    profileMessageType.value = "success";
    profileMessage.value = "Profile updated.";
  } catch (error) {
    if (await handleAuthError(error)) {
      return;
    }

    if (error?.fieldErrors?.displayName) {
      profileFieldErrors.displayName = String(error.fieldErrors.displayName);
    }

    profileMessageType.value = "error";
    profileMessage.value = toErrorMessage(error, "Unable to update profile.");
  }
}

async function openAvatarEditor() {
  avatarMessage.value = "";
  setupAvatarUploader();
  const uppy = avatarUppy.value;
  if (!uppy) {
    avatarMessageType.value = "error";
    avatarMessage.value = "Avatar editor is unavailable in this environment.";
    return;
  }

  const dashboard = uppy.getPlugin("Dashboard");
  if (dashboard && typeof dashboard.openModal === "function") {
    dashboard.openModal();
  }
}

async function submitAvatarDelete() {
  avatarMessage.value = "";

  try {
    const data = await avatarDeleteMutation.mutateAsync();
    queryClient.setQueryData(SETTINGS_QUERY_KEY, data);
    applySettingsData(data);
    avatarMessageType.value = "success";
    avatarMessage.value = "Avatar removed.";
  } catch (error) {
    if (await handleAuthError(error)) {
      return;
    }

    avatarMessageType.value = "error";
    avatarMessage.value = toErrorMessage(error, "Unable to remove avatar.");
  }
}

async function submitPreferences() {
  clearFieldErrors(preferencesFieldErrors);
  preferencesMessage.value = "";

  try {
    const data = await preferencesMutation.mutateAsync({
      theme: preferencesForm.theme,
      locale: preferencesForm.locale,
      timeZone: preferencesForm.timeZone,
      dateFormat: preferencesForm.dateFormat,
      numberFormat: preferencesForm.numberFormat,
      currencyCode: preferencesForm.currencyCode,
      avatarSize: Number(preferencesForm.avatarSize)
    });

    queryClient.setQueryData(SETTINGS_QUERY_KEY, data);
    applySettingsData(data);
    preferencesMessageType.value = "success";
    preferencesMessage.value = "Preferences updated.";
  } catch (error) {
    if (await handleAuthError(error)) {
      return;
    }

    if (error?.fieldErrors && typeof error.fieldErrors === "object") {
      for (const key of Object.keys(preferencesFieldErrors)) {
        if (error.fieldErrors[key]) {
          preferencesFieldErrors[key] = String(error.fieldErrors[key]);
        }
      }
    }

    preferencesMessageType.value = "error";
    preferencesMessage.value = toErrorMessage(error, "Unable to update preferences.");
  }
}

async function submitNotifications() {
  notificationsMessage.value = "";

  try {
    const data = await notificationsMutation.mutateAsync({
      productUpdates: notificationsForm.productUpdates,
      accountActivity: notificationsForm.accountActivity,
      securityAlerts: true
    });

    queryClient.setQueryData(SETTINGS_QUERY_KEY, data);
    applySettingsData(data);
    notificationsMessageType.value = "success";
    notificationsMessage.value = "Notification settings updated.";
  } catch (error) {
    if (await handleAuthError(error)) {
      return;
    }

    notificationsMessageType.value = "error";
    notificationsMessage.value = toErrorMessage(error, "Unable to update notifications.");
  }
}

async function submitPasswordChange() {
  if (!canSubmitPasswordForm.value) {
    securityMessageType.value = "error";
    securityMessage.value = isPasswordEnableSetupMode.value
      ? "Password sign-in cannot be enabled right now."
      : "Enable password sign-in before setting or changing password.";
    return;
  }

  clearFieldErrors(securityFieldErrors);
  securityMessage.value = "";
  const enableAfterPasswordSetup = isPasswordEnableSetupMode.value;
  if (enableAfterPasswordSetup) {
    methodActionLoadingId.value = AUTH_METHOD_PASSWORD_ID;
  }

  try {
    const response = await passwordMutation.mutateAsync({
      currentPassword: requiresCurrentPassword.value ? securityForm.currentPassword : undefined,
      newPassword: securityForm.newPassword,
      confirmPassword: securityForm.confirmPassword
    });

    if (enableAfterPasswordSetup) {
      const data = await setPasswordMethodEnabledMutation.mutateAsync({
        enabled: true
      });
      queryClient.setQueryData(SETTINGS_QUERY_KEY, data);
      applySettingsData(data);
      providerMessageType.value = "success";
      providerMessage.value = "Password sign-in enabled.";
      securityMessageType.value = "success";
      securityMessage.value = "Password sign-in enabled.";
    } else {
      securityMessageType.value = "success";
      securityMessage.value = String(response?.message || "Password updated.");
    }

    closePasswordForm();
    await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
  } catch (error) {
    if (await handleAuthError(error)) {
      return;
    }

    if (error?.fieldErrors && typeof error.fieldErrors === "object") {
      for (const key of Object.keys(securityFieldErrors)) {
        if (error.fieldErrors[key]) {
          securityFieldErrors[key] = String(error.fieldErrors[key]);
        }
      }
    }

    securityMessageType.value = "error";
    securityMessage.value = toErrorMessage(
      error,
      enableAfterPasswordSetup ? "Unable to enable password sign-in." : "Unable to update password."
    );
  } finally {
    if (enableAfterPasswordSetup) {
      methodActionLoadingId.value = "";
    }
  }
}

function openPasswordForm() {
  if (!canOpenPasswordManageForm.value) {
    securityMessageType.value = "error";
    securityMessage.value = "Enable password sign-in before setting or changing password.";
    return;
  }

  providerMessage.value = "";
  passwordFormMode.value = PASSWORD_FORM_MODE_MANAGE;
  securityForm.currentPassword = "";
  securityForm.newPassword = "";
  securityForm.confirmPassword = "";
  showCurrentPassword.value = false;
  showNewPassword.value = false;
  showConfirmPassword.value = false;
  clearFieldErrors(securityFieldErrors);
  securityMessage.value = "";
  showPasswordForm.value = true;
}

function openPasswordEnableSetup() {
  if (!canOpenPasswordEnableSetup.value) {
    providerMessageType.value = "error";
    providerMessage.value = "Password sign-in cannot be enabled right now.";
    return;
  }

  providerMessage.value = "";
  passwordFormMode.value = PASSWORD_FORM_MODE_ENABLE;
  securityForm.currentPassword = "";
  securityForm.newPassword = "";
  securityForm.confirmPassword = "";
  showCurrentPassword.value = false;
  showNewPassword.value = false;
  showConfirmPassword.value = false;
  clearFieldErrors(securityFieldErrors);
  securityMessage.value = "";
  showPasswordForm.value = true;
}

function closePasswordForm() {
  showPasswordForm.value = false;
  passwordFormMode.value = PASSWORD_FORM_MODE_MANAGE;
  securityForm.currentPassword = "";
  securityForm.newPassword = "";
  securityForm.confirmPassword = "";
  showCurrentPassword.value = false;
  showNewPassword.value = false;
  showConfirmPassword.value = false;
  clearFieldErrors(securityFieldErrors);
  securityMessage.value = "";
}

async function submitPasswordMethodToggle(enabled) {
  providerMessage.value = "";
  methodActionLoadingId.value = AUTH_METHOD_PASSWORD_ID;

  try {
    const data = await setPasswordMethodEnabledMutation.mutateAsync({
      enabled
    });
    queryClient.setQueryData(SETTINGS_QUERY_KEY, data);
    applySettingsData(data);
    providerMessageType.value = "success";
    providerMessage.value = enabled ? "Password sign-in enabled." : "Password sign-in disabled.";
  } catch (error) {
    if (await handleAuthError(error)) {
      return;
    }

    providerMessageType.value = "error";
    providerMessage.value = toErrorMessage(error, "Unable to update password sign-in method.");
  } finally {
    methodActionLoadingId.value = "";
  }
}

async function startProviderLink(providerId) {
  const provider = normalizeOAuthProvider(providerId, { fallback: null });
  if (!provider) {
    providerMessageType.value = "error";
    providerMessage.value = "OAuth provider is not supported.";
    return;
  }

  providerMessage.value = "";
  providerLinkStartInFlight.value = true;
  const settingsPath = resolveCurrentSettingsPath();
  if (!settingsPath) {
    providerMessageType.value = "error";
    providerMessage.value = "Unable to resolve settings route for provider link.";
    providerLinkStartInFlight.value = false;
    return;
  }
  const returnTo = buildSettingsPathWithTab("security");
  writePendingOAuthContext({
    provider,
    intent: "link",
    returnTo
  });

  if (typeof window !== "undefined") {
    window.location.assign(api.settingsOAuthLinkStartUrl(provider, { returnTo }));
    return;
  }

  providerLinkStartInFlight.value = false;
}

async function submitProviderUnlink(providerId) {
  const provider = normalizeOAuthProvider(providerId, { fallback: null });
  if (!provider) {
    providerMessageType.value = "error";
    providerMessage.value = "OAuth provider is not supported.";
    return;
  }

  providerMessage.value = "";
  methodActionLoadingId.value = buildOAuthMethodId(provider) || provider;

  try {
    const data = await unlinkProviderMutation.mutateAsync(provider);
    queryClient.setQueryData(SETTINGS_QUERY_KEY, data);
    applySettingsData(data);
    providerMessageType.value = "success";
    providerMessage.value = `${providerLabel(provider)} unlinked.`;
  } catch (error) {
    if (await handleAuthError(error)) {
      return;
    }

    providerMessageType.value = "error";
    providerMessage.value = toErrorMessage(error, "Unable to unlink provider.");
  } finally {
    methodActionLoadingId.value = "";
  }
}

async function submitLogoutOthers() {
  sessionsMessage.value = "";

  try {
    const response = await logoutOthersMutation.mutateAsync();
    sessionsMessageType.value = "success";
    sessionsMessage.value = String(response?.message || "Signed out from other active sessions.");
  } catch (error) {
    if (await handleAuthError(error)) {
      return;
    }

    sessionsMessageType.value = "error";
    sessionsMessage.value = toErrorMessage(error, "Unable to sign out other sessions.");
  }
}

onMounted(async () => {
  setupAvatarUploader();
  await handleOAuthCallbackIfPresent();
  settingsEnabled.value = true;
});

onBeforeUnmount(() => {
  if (avatarUppy.value) {
    avatarUppy.value.destroy();
    avatarUppy.value = null;
  }
});
</script>

<style scoped>
.panel-card {
  background-color: rgb(var(--v-theme-surface));
}

.panel-title {
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}
</style>
