<script setup>
import { computed, markRaw, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { useTheme } from "vuetify";
import { useRoute } from "vue-router";
import Uppy from "@uppy/core";
import Dashboard from "@uppy/dashboard";
import ImageEditor from "@uppy/image-editor";
import Compressor from "@uppy/compressor";
import XHRUpload from "@uppy/xhr-upload";
import "@uppy/core/css/style.min.css";
import "@uppy/dashboard/css/style.min.css";
import "@uppy/image-editor/css/style.min.css";
import ProfileClientElement from "./ProfileClientElement.vue";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { resolveFieldErrors } from "@jskit-ai/http-runtime/client";
import { usersWebHttpClient } from "../lib/httpClient.js";
import { useAddEdit } from "../composables/useAddEdit.js";
import { useCommand } from "../composables/useCommand.js";
import { useView } from "../composables/useView.js";
import { ACCOUNT_SETTINGS_CHANGED_EVENT } from "@jskit-ai/users-core/shared/events/usersEvents";

const AVATAR_ALLOWED_MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);
const AVATAR_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const AVATAR_DEFAULT_SIZE = 64;

const SETTINGS_SECTIONS = Object.freeze([
  { title: "Profile", value: "profile" },
  { title: "Preferences", value: "preferences" },
  { title: "Notifications", value: "notifications" }
]);

const THEME_OPTIONS = Object.freeze([
  { title: "System", value: "system" },
  { title: "Light", value: "light" },
  { title: "Dark", value: "dark" }
]);

const LOCALE_OPTIONS = Object.freeze([
  { title: "English (US)", value: "en-US" },
  { title: "English (UK)", value: "en-GB" },
  { title: "Italian", value: "it-IT" },
  { title: "Spanish", value: "es-ES" }
]);

const DATE_FORMAT_OPTIONS = Object.freeze([
  { title: "System", value: "system" },
  { title: "MM/DD/YYYY", value: "mdy" },
  { title: "DD/MM/YYYY", value: "dmy" },
  { title: "YYYY-MM-DD", value: "ymd" }
]);

const NUMBER_FORMAT_OPTIONS = Object.freeze([
  { title: "System", value: "system" },
  { title: "1,234.56", value: "comma-dot" },
  { title: "1.234,56", value: "dot-comma" },
  { title: "1 234,56", value: "space-comma" }
]);

const CURRENCY_OPTIONS = Object.freeze(["USD", "EUR", "GBP", "AUD", "JPY"]);

const TIME_ZONE_OPTIONS = Object.freeze([
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Rome",
  "Asia/Tokyo",
  "Australia/Sydney"
]);

const AVATAR_SIZE_OPTIONS = Object.freeze([32, 40, 48, 56, 64, 72, 80, 96, 112, 128]);

const DEFAULTS = Object.freeze({
  preferences: {
    theme: "system",
    locale: "en-US",
    timeZone: "UTC",
    dateFormat: "system",
    numberFormat: "system",
    currencyCode: "USD",
    avatarSize: AVATAR_DEFAULT_SIZE
  },
  notifications: {
    productUpdates: true,
    accountActivity: true,
    securityAlerts: true
  }
});

const route = useRoute();
const queryClient = useQueryClient();
const errorRuntime = useShellWebErrorRuntime();

const accountSettingsQueryKey = ["users-web", "settings", "account"];

function normalizeReturnToPath(value, fallback = "/") {
  const source = Array.isArray(value) ? value[0] : value;
  const rawValue = String(source || "").trim();
  if (!rawValue || !rawValue.startsWith("/") || rawValue.startsWith("//")) {
    return fallback;
  }

  const normalizedPathname =
    rawValue.split("?")[0].split("#")[0].replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
  if (normalizedPathname === "/account/settings") {
    return fallback;
  }

  return rawValue;
}

const backTarget = computed(() => normalizeReturnToPath(route?.query?.returnTo, "/"));

const vuetifyTheme = useTheme();
const activeTab = ref("profile");

const profileForm = reactive({
  displayName: "",
  email: ""
});

const preferencesForm = reactive({
  theme: DEFAULTS.preferences.theme,
  locale: DEFAULTS.preferences.locale,
  timeZone: DEFAULTS.preferences.timeZone,
  dateFormat: DEFAULTS.preferences.dateFormat,
  numberFormat: DEFAULTS.preferences.numberFormat,
  currencyCode: DEFAULTS.preferences.currencyCode,
  avatarSize: DEFAULTS.preferences.avatarSize
});

const notificationsForm = reactive({
  productUpdates: DEFAULTS.notifications.productUpdates,
  accountActivity: DEFAULTS.notifications.accountActivity,
  securityAlerts: DEFAULTS.notifications.securityAlerts
});

const profileAvatar = reactive({
  uploadedUrl: null,
  gravatarUrl: "",
  effectiveUrl: "",
  hasUploadedAvatar: false,
  size: DEFAULTS.preferences.avatarSize,
  version: null
});

const selectedAvatarFileName = ref("");
const avatarUppy = ref(null);

const sessionQueryKey = Object.freeze(["users-web", "session", "csrf"]);

const profileInitials = computed(() => {
  const source = String(profileForm.displayName || profileForm.email || "U").trim();
  return source.slice(0, 2).toUpperCase() || "U";
});

function reportAccountFeedback({
  message,
  severity = "error",
  channel = "banner",
  dedupeKey = ""
} = {}) {
  const normalizedMessage = String(message || "").trim();
  if (!normalizedMessage) {
    return;
  }

  errorRuntime.report({
    source: "users-web.account-settings-view",
    message: normalizedMessage,
    severity,
    channel,
    dedupeKey: dedupeKey || `users-web.account-settings-view:${severity}:${normalizedMessage}`,
    dedupeWindowMs: 3000
  });
}

function normalizeSettingsPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}
function normalizeAvatarSize(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    return DEFAULTS.preferences.avatarSize;
  }

  const clamped = Math.min(128, Math.max(32, numeric));
  return clamped;
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

function applyAvatarData(avatar) {
  const nextAvatar = avatar && typeof avatar === "object" ? avatar : {};

  profileAvatar.uploadedUrl = nextAvatar.uploadedUrl ? String(nextAvatar.uploadedUrl) : null;
  profileAvatar.gravatarUrl = String(nextAvatar.gravatarUrl || "");
  profileAvatar.effectiveUrl = String(nextAvatar.effectiveUrl || profileAvatar.gravatarUrl || "");
  profileAvatar.hasUploadedAvatar = Boolean(nextAvatar.hasUploadedAvatar);
  profileAvatar.size = normalizeAvatarSize(nextAvatar.size || preferencesForm.avatarSize || AVATAR_DEFAULT_SIZE);
  profileAvatar.version = nextAvatar.version == null ? null : String(nextAvatar.version);
}

function applySettingsData(payload) {
  const data = normalizeSettingsPayload(payload);

  profileForm.displayName = String(data.profile?.displayName || "");
  profileForm.email = String(data.profile?.email || "");
  applyAvatarData(data.profile?.avatar);

  preferencesForm.theme = String(data.preferences?.theme || DEFAULTS.preferences.theme);
  preferencesForm.locale = String(data.preferences?.locale || DEFAULTS.preferences.locale);
  preferencesForm.timeZone = String(data.preferences?.timeZone || DEFAULTS.preferences.timeZone);
  preferencesForm.dateFormat = String(data.preferences?.dateFormat || DEFAULTS.preferences.dateFormat);
  preferencesForm.numberFormat = String(data.preferences?.numberFormat || DEFAULTS.preferences.numberFormat);
  preferencesForm.currencyCode = String(data.preferences?.currencyCode || DEFAULTS.preferences.currencyCode);
  preferencesForm.avatarSize = normalizeAvatarSize(data.preferences?.avatarSize || DEFAULTS.preferences.avatarSize);

  notificationsForm.productUpdates = Boolean(data.notifications?.productUpdates);
  notificationsForm.accountActivity = Boolean(data.notifications?.accountActivity);
  notificationsForm.securityAlerts = DEFAULTS.notifications.securityAlerts;

  applyThemePreference(preferencesForm.theme);
}

const mapAccountSettingsPayload = (_model, payload = {}) => {
  applySettingsData(payload);
};

const settingsView = useView({
  visibility: "public",
  apiSuffix: "/settings",
  queryKeyFactory: () => accountSettingsQueryKey,
  realtime: {
    event: ACCOUNT_SETTINGS_CHANGED_EVENT
  },
  fallbackLoadError: "Unable to load settings.",
  mapLoadedToModel: mapAccountSettingsPayload
});

const profileAddEdit = useAddEdit({
  visibility: "public",
  apiSuffix: "/settings/profile",
  queryKeyFactory: () => accountSettingsQueryKey,
  readEnabled: false,
  writeMethod: "PATCH",
  fallbackSaveError: "Unable to update profile.",
  fieldErrorKeys: ["displayName"],
  model: profileForm,
  mapLoadedToModel: mapAccountSettingsPayload,
  buildRawPayload: (model) => ({
    displayName: String(model.displayName || "").trim()
  }),
  messages: {
    saveSuccess: "Profile updated.",
    saveError: "Unable to update profile."
  }
});

const avatarDeleteCommand = useCommand({
  visibility: "public",
  apiSuffix: "/settings/profile/avatar",
  writeMethod: "DELETE",
  fallbackRunError: "Unable to remove avatar.",
  model: profileForm,
  onRunSuccess: (payload, { queryClient: commandQueryClient }) => {
    applySettingsData(payload);
    commandQueryClient.setQueryData(accountSettingsQueryKey, payload);
  },
  messages: {
    success: "Avatar removed.",
    error: "Unable to remove avatar."
  }
});

const preferencesAddEdit = useAddEdit({
  visibility: "public",
  apiSuffix: "/settings/preferences",
  queryKeyFactory: () => accountSettingsQueryKey,
  readEnabled: false,
  writeMethod: "PATCH",
  fallbackSaveError: "Unable to update preferences.",
  fieldErrorKeys: ["theme", "locale", "timeZone", "dateFormat", "numberFormat", "currencyCode", "avatarSize"],
  model: preferencesForm,
  mapLoadedToModel: mapAccountSettingsPayload,
  buildRawPayload: (model) => ({
    theme: model.theme,
    locale: model.locale,
    timeZone: model.timeZone,
    dateFormat: model.dateFormat,
    numberFormat: model.numberFormat,
    currencyCode: model.currencyCode,
    avatarSize: Number(model.avatarSize)
  }),
  messages: {
    saveSuccess: "Preferences updated.",
    saveError: "Unable to update preferences."
  }
});

const notificationsAddEdit = useAddEdit({
  visibility: "public",
  apiSuffix: "/settings/notifications",
  queryKeyFactory: () => accountSettingsQueryKey,
  readEnabled: false,
  writeMethod: "PATCH",
  fallbackSaveError: "Unable to update notifications.",
  model: notificationsForm,
  mapLoadedToModel: mapAccountSettingsPayload,
  buildRawPayload: (model) => ({
    productUpdates: Boolean(model.productUpdates),
    accountActivity: Boolean(model.accountActivity),
    securityAlerts: true
  }),
  messages: {
    saveSuccess: "Notification settings updated.",
    saveError: "Unable to update notifications."
  }
});

const loadingSettings = computed(() => Boolean(settingsView.isLoading.value));

const page = Object.freeze({
  meta: {
    settingsSections: SETTINGS_SECTIONS
  },
  state: reactive({
    activeTab
  })
});

const profileState = reactive({
  preferencesForm,
  profileAvatar,
  profileInitials,
  selectedAvatarFileName,
  profileForm,
  profileFieldErrors: profileAddEdit.fieldErrors,
  avatarDeleteMutation: markRaw({
    isPending: avatarDeleteCommand.isRunning
  }),
  profileMutation: markRaw({
    isPending: profileAddEdit.isSaving
  })
});

const profileActions = Object.freeze({
  submitProfile,
  openAvatarEditor,
  submitAvatarDelete
});

const preferences = Object.freeze({
  meta: {
    themeOptions: THEME_OPTIONS,
    localeOptions: LOCALE_OPTIONS,
    timeZoneOptions: TIME_ZONE_OPTIONS,
    dateFormatOptions: DATE_FORMAT_OPTIONS,
    numberFormatOptions: NUMBER_FORMAT_OPTIONS,
    currencyOptions: CURRENCY_OPTIONS,
    avatarSizeOptions: AVATAR_SIZE_OPTIONS
  },
  state: reactive({
    preferencesForm,
    preferencesFieldErrors: preferencesAddEdit.fieldErrors,
    preferencesMutation: markRaw({
      isPending: preferencesAddEdit.isSaving
    })
  }),
  actions: {
    submitPreferences
  }
});

const notifications = Object.freeze({
  state: reactive({
    notificationsForm,
    notificationsMutation: markRaw({
      isPending: notificationsAddEdit.isSaving
    })
  }),
  actions: {
    submitNotifications
  }
});

async function submitProfile() {
  await profileAddEdit.submit();
}

async function resolveCsrfToken() {
  const sessionPayload = await queryClient.fetchQuery({
    queryKey: sessionQueryKey,
    queryFn: () =>
      usersWebHttpClient.request("/api/session", {
        method: "GET"
      }),
    staleTime: 60_000
  });

  const csrfToken = String(sessionPayload?.csrfToken || "");
  if (!csrfToken) {
    throw new Error("Unable to prepare secure avatar upload request.");
  }

  return csrfToken;
}

function setupAvatarUploader() {
  if (typeof window === "undefined") {
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
      const csrfToken = await resolveCsrfToken();
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
      reportAccountFeedback({
        message: "Avatar uploaded, but the response payload was invalid.",
        severity: "error",
        channel: "banner",
        dedupeKey: "users-web.account-settings-view:avatar-upload-invalid-response"
      });
      return;
    }

    applySettingsData(data);
    queryClient.setQueryData(accountSettingsQueryKey, data);

    const dashboard = uppy.getPlugin("Dashboard");
    if (dashboard && typeof dashboard.closeModal === "function") {
      dashboard.closeModal();
    }

    reportAccountFeedback({
      message: "Avatar uploaded.",
      severity: "success",
      channel: "snackbar",
      dedupeKey: "users-web.account-settings-view:avatar-uploaded"
    });
    selectedAvatarFileName.value = "";
  });

  uppy.on("upload-error", (_file, error, response) => {
    const body = response?.body && typeof response.body === "object" ? response.body : {};
    const fieldErrors = resolveFieldErrors(body);

    reportAccountFeedback({
      message: String(fieldErrors.avatar || body?.error || error?.message || "Unable to upload avatar."),
      severity: "error",
      channel: "banner",
      dedupeKey: "users-web.account-settings-view:avatar-upload-error"
    });
  });

  uppy.on("restriction-failed", (_file, error) => {
    reportAccountFeedback({
      message: String(error?.message || "Selected avatar file does not meet upload restrictions."),
      severity: "error",
      channel: "banner",
      dedupeKey: "users-web.account-settings-view:avatar-upload-restriction"
    });
  });

  uppy.on("complete", (result) => {
    const successfulCount = Array.isArray(result?.successful) ? result.successful.length : 0;
    if (successfulCount <= 0) {
      return;
    }

    try {
      uppy.clear();
    } catch {
      // Upload succeeded; ignore clear timing issues.
    }
  });

  avatarUppy.value = markRaw(uppy);
}

async function openAvatarEditor() {
  setupAvatarUploader();

  const uppy = avatarUppy.value;
  if (!uppy) {
    reportAccountFeedback({
      message: "Avatar editor is unavailable in this environment.",
      severity: "error",
      channel: "banner",
      dedupeKey: "users-web.account-settings-view:avatar-editor-unavailable"
    });
    return;
  }

  const dashboard = uppy.getPlugin("Dashboard");
  if (dashboard && typeof dashboard.openModal === "function") {
    dashboard.openModal();
  }
}

async function submitAvatarDelete() {
  try {
    await avatarDeleteCommand.run();
  } catch {
    // Error feedback is already handled in useCommand.
  }
}

async function submitPreferences() {
  await preferencesAddEdit.submit();
}

async function submitNotifications() {
  await notificationsAddEdit.submit();
}

watch(
  () => preferencesForm.avatarSize,
  (nextSize) => {
    profileAvatar.size = normalizeAvatarSize(nextSize || AVATAR_DEFAULT_SIZE);
  },
  { immediate: true }
);

onMounted(() => {
  setupAvatarUploader();
});

onBeforeUnmount(() => {
  if (avatarUppy.value) {
    avatarUppy.value.destroy();
    avatarUppy.value = null;
  }
});
</script>

<template>
  <section class="settings-view py-2 py-md-4">
    <v-card class="panel-card" rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="panel-title">Account settings</v-card-title>
        <v-card-subtitle>Global profile, preferences, and notification controls.</v-card-subtitle>
        <template #append>
          <v-btn variant="text" color="secondary" :to="backTarget">Back</v-btn>
        </template>
      </v-card-item>
      <v-divider />

      <v-card-text class="pt-4">
        <v-progress-linear v-if="loadingSettings" indeterminate class="mb-4" />

        <v-row class="settings-layout" no-gutters>
          <v-col cols="12" md="3" lg="2" class="pr-md-4 mb-4 mb-md-0">
            <v-list nav density="comfortable" class="settings-section-list rounded-lg">
              <v-list-item
                v-for="section in page.meta.settingsSections"
                :key="section.value"
                :title="section.title"
                :active="page.state.activeTab === section.value"
                rounded="lg"
                @click="page.state.activeTab = section.value"
              />
            </v-list>
          </v-col>

          <v-col cols="12" md="9" lg="10">
            <v-window v-model="page.state.activeTab" :touch="false" class="settings-sections-window">
              <v-window-item value="profile">
                <ProfileClientElement :state="profileState" :actions="profileActions" />
              </v-window-item>

              <v-window-item value="preferences">
                <v-card rounded="lg" elevation="0" border>
                  <v-card-item>
                    <v-card-title class="text-subtitle-1">Preferences</v-card-title>
                  </v-card-item>
                  <v-divider />
                  <v-card-text>
                    <v-form @submit.prevent="preferences.actions.submitPreferences" novalidate>
                      <v-row>
                        <v-col cols="12" md="4">
                          <v-select
                            v-model="preferences.state.preferencesForm.theme"
                            label="Theme"
                            :items="preferences.meta.themeOptions"
                            item-title="title"
                            item-value="value"
                            variant="outlined"
                            density="comfortable"
                            :error-messages="
                              preferences.state.preferencesFieldErrors.theme
                                ? [preferences.state.preferencesFieldErrors.theme]
                                : []
                            "
                          />
                        </v-col>
                        <v-col cols="12" md="4">
                          <v-select
                            v-model="preferences.state.preferencesForm.locale"
                            label="Language / locale"
                            :items="preferences.meta.localeOptions"
                            item-title="title"
                            item-value="value"
                            variant="outlined"
                            density="comfortable"
                            :error-messages="
                              preferences.state.preferencesFieldErrors.locale
                                ? [preferences.state.preferencesFieldErrors.locale]
                                : []
                            "
                          />
                        </v-col>
                        <v-col cols="12" md="4">
                          <v-select
                            v-model="preferences.state.preferencesForm.timeZone"
                            label="Time zone"
                            :items="preferences.meta.timeZoneOptions"
                            variant="outlined"
                            density="comfortable"
                            :error-messages="
                              preferences.state.preferencesFieldErrors.timeZone
                                ? [preferences.state.preferencesFieldErrors.timeZone]
                                : []
                            "
                          />
                        </v-col>

                        <v-col cols="12" md="4">
                          <v-select
                            v-model="preferences.state.preferencesForm.dateFormat"
                            label="Date format"
                            :items="preferences.meta.dateFormatOptions"
                            item-title="title"
                            item-value="value"
                            variant="outlined"
                            density="comfortable"
                            :error-messages="
                              preferences.state.preferencesFieldErrors.dateFormat
                                ? [preferences.state.preferencesFieldErrors.dateFormat]
                                : []
                            "
                          />
                        </v-col>
                        <v-col cols="12" md="4">
                          <v-select
                            v-model="preferences.state.preferencesForm.numberFormat"
                            label="Number format"
                            :items="preferences.meta.numberFormatOptions"
                            item-title="title"
                            item-value="value"
                            variant="outlined"
                            density="comfortable"
                            :error-messages="
                              preferences.state.preferencesFieldErrors.numberFormat
                                ? [preferences.state.preferencesFieldErrors.numberFormat]
                                : []
                            "
                          />
                        </v-col>
                        <v-col cols="12" md="4">
                          <v-select
                            v-model="preferences.state.preferencesForm.currencyCode"
                            label="Currency"
                            :items="preferences.meta.currencyOptions"
                            variant="outlined"
                            density="comfortable"
                            :error-messages="
                              preferences.state.preferencesFieldErrors.currencyCode
                                ? [preferences.state.preferencesFieldErrors.currencyCode]
                                : []
                            "
                          />
                        </v-col>
                        <v-col cols="12" md="3">
                          <v-select
                            v-model.number="preferences.state.preferencesForm.avatarSize"
                            label="Avatar size"
                            :items="preferences.meta.avatarSizeOptions"
                            variant="outlined"
                            density="comfortable"
                            :error-messages="
                              preferences.state.preferencesFieldErrors.avatarSize
                                ? [preferences.state.preferencesFieldErrors.avatarSize]
                                : []
                            "
                          />
                        </v-col>
                      </v-row>
                      <v-btn type="submit" color="primary" :loading="preferences.state.preferencesMutation.isPending.value">
                        Save preferences
                      </v-btn>
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
                    <v-form @submit.prevent="notifications.actions.submitNotifications" novalidate>
                      <v-switch
                        v-model="notifications.state.notificationsForm.productUpdates"
                        label="Product updates"
                        color="primary"
                        hide-details
                        class="mb-2"
                      />
                      <v-switch
                        v-model="notifications.state.notificationsForm.accountActivity"
                        label="Account activity alerts"
                        color="primary"
                        hide-details
                        class="mb-2"
                      />
                      <v-switch
                        v-model="notifications.state.notificationsForm.securityAlerts"
                        label="Security alerts (required)"
                        color="primary"
                        hide-details
                        disabled
                        class="mb-4"
                      />
                      <v-btn
                        type="submit"
                        color="primary"
                        :loading="notifications.state.notificationsMutation.isPending.value"
                      >
                        Save notification settings
                      </v-btn>
                    </v-form>
                  </v-card-text>
                </v-card>
              </v-window-item>
            </v-window>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>
  </section>
</template>

<style scoped>
.panel-card {
  background-color: rgb(var(--v-theme-surface));
}

.panel-title {
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.settings-section-list {
  border: 1px solid rgba(var(--v-theme-outline), 0.35);
}

:deep(.settings-section-list .v-list-item--active) {
  background-color: rgba(var(--v-theme-primary), 0.14);
}

:deep(.settings-sections-window .v-window-x-transition-enter-active),
:deep(.settings-sections-window .v-window-x-transition-leave-active),
:deep(.settings-sections-window .v-window-x-reverse-transition-enter-active),
:deep(.settings-sections-window .v-window-x-reverse-transition-leave-active) {
  transition: none !important;
}
</style>
