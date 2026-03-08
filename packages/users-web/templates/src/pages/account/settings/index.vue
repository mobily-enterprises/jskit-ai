<script>
export const routeMeta = {
  jskit: {
    scope: "global"
  }
};
</script>

<script setup>
import { computed, markRaw, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
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
import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { ProfileClientElement } from "@jskit-ai/users-web/client";

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

const client = createHttpClient({
  credentials: "include",
  csrf: {
    sessionPath: "/api/session"
  }
});
const route = useRoute();

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

const backTarget = computed(() => normalizeReturnToPath(route.query?.returnTo, "/"));

const vuetifyTheme = useTheme();
const activeTab = ref("profile");
const loadingSettings = ref(false);
const loadError = ref("");

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

const profileMessage = ref("");
const profileMessageType = ref("success");
const avatarMessage = ref("");
const avatarMessageType = ref("success");
const preferencesMessage = ref("");
const preferencesMessageType = ref("success");
const notificationsMessage = ref("");
const notificationsMessageType = ref("success");

const profileMutationPending = ref(false);
const avatarDeleteMutationPending = ref(false);
const preferencesMutationPending = ref(false);
const notificationsMutationPending = ref(false);

const profileInitials = computed(() => {
  const source = String(profileForm.displayName || profileForm.email || "U").trim();
  return source.slice(0, 2).toUpperCase() || "U";
});

const page = Object.freeze({
  meta: {
    settingsSections: SETTINGS_SECTIONS
  },
  state: reactive({
    activeTab,
    loadError
  })
});

const profileState = reactive({
  preferencesForm,
  profileAvatar,
  profileInitials,
  selectedAvatarFileName,
  avatarMessage,
  avatarMessageType,
  profileForm,
  profileFieldErrors,
  profileMessage,
  profileMessageType,
  avatarDeleteMutation: {
    isPending: avatarDeleteMutationPending
  },
  profileMutation: {
    isPending: profileMutationPending
  }
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
    preferencesFieldErrors,
    preferencesMessage,
    preferencesMessageType,
    preferencesMutation: {
      isPending: preferencesMutationPending
    }
  }),
  actions: {
    submitPreferences
  }
});

const notifications = Object.freeze({
  state: reactive({
    notificationsForm,
    notificationsMessage,
    notificationsMessageType,
    notificationsMutation: {
      isPending: notificationsMutationPending
    }
  }),
  actions: {
    submitNotifications
  }
});

function toObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function clearFieldErrors(fieldErrors) {
  for (const key of Object.keys(fieldErrors)) {
    fieldErrors[key] = "";
  }
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
  const data = toObject(payload);

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

async function loadSettings() {
  loadingSettings.value = true;
  loadError.value = "";

  try {
    const data = await client.request("/api/settings", {
      method: "GET"
    });

    applySettingsData(data);
  } catch (error) {
    loadError.value = String(error?.message || "Unable to load settings.");
  } finally {
    loadingSettings.value = false;
  }
}

async function submitProfile() {
  clearFieldErrors(profileFieldErrors);
  profileMessage.value = "";

  profileMutationPending.value = true;
  try {
    const data = await client.request("/api/settings/profile", {
      method: "PATCH",
      body: {
        displayName: profileForm.displayName
      }
    });

    applySettingsData(data);
    profileMessageType.value = "success";
    profileMessage.value = "Profile updated.";
  } catch (error) {
    if (error?.fieldErrors?.displayName) {
      profileFieldErrors.displayName = String(error.fieldErrors.displayName);
    }

    profileMessageType.value = "error";
    profileMessage.value = String(error?.message || "Unable to update profile.");
  } finally {
    profileMutationPending.value = false;
  }
}

async function resolveCsrfToken() {
  const sessionPayload = await client.request("/api/session", {
    method: "GET"
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
      avatarMessageType.value = "error";
      avatarMessage.value = "Avatar uploaded, but the response payload was invalid.";
      return;
    }

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
    const body = response?.body && typeof response.body === "object" ? response.body : {};
    const fieldErrors =
      body?.fieldErrors && typeof body.fieldErrors === "object"
        ? body.fieldErrors
        : body?.details?.fieldErrors && typeof body.details.fieldErrors === "object"
          ? body.details.fieldErrors
          : {};

    avatarMessageType.value = "error";
    avatarMessage.value = String(fieldErrors.avatar || body?.error || error?.message || "Unable to upload avatar.");
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
      // Upload succeeded; ignore clear timing issues.
    }
  });

  avatarUppy.value = markRaw(uppy);
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

  avatarDeleteMutationPending.value = true;
  try {
    const data = await client.request("/api/settings/profile/avatar", {
      method: "DELETE"
    });

    applySettingsData(data);
    avatarMessageType.value = "success";
    avatarMessage.value = "Avatar removed.";
  } catch (error) {
    avatarMessageType.value = "error";
    avatarMessage.value = String(error?.message || "Unable to remove avatar.");
  } finally {
    avatarDeleteMutationPending.value = false;
  }
}

async function submitPreferences() {
  clearFieldErrors(preferencesFieldErrors);
  preferencesMessage.value = "";

  preferencesMutationPending.value = true;
  try {
    const data = await client.request("/api/settings/preferences", {
      method: "PATCH",
      body: {
        theme: preferencesForm.theme,
        locale: preferencesForm.locale,
        timeZone: preferencesForm.timeZone,
        dateFormat: preferencesForm.dateFormat,
        numberFormat: preferencesForm.numberFormat,
        currencyCode: preferencesForm.currencyCode,
        avatarSize: Number(preferencesForm.avatarSize)
      }
    });

    applySettingsData(data);
    preferencesMessageType.value = "success";
    preferencesMessage.value = "Preferences updated.";
  } catch (error) {
    if (error?.fieldErrors && typeof error.fieldErrors === "object") {
      for (const key of Object.keys(preferencesFieldErrors)) {
        if (error.fieldErrors[key]) {
          preferencesFieldErrors[key] = String(error.fieldErrors[key]);
        }
      }
    }

    preferencesMessageType.value = "error";
    preferencesMessage.value = String(error?.message || "Unable to update preferences.");
  } finally {
    preferencesMutationPending.value = false;
  }
}

async function submitNotifications() {
  notificationsMessage.value = "";

  notificationsMutationPending.value = true;
  try {
    const data = await client.request("/api/settings/notifications", {
      method: "PATCH",
      body: {
        productUpdates: notificationsForm.productUpdates,
        accountActivity: notificationsForm.accountActivity,
        securityAlerts: true
      }
    });

    applySettingsData(data);
    notificationsMessageType.value = "success";
    notificationsMessage.value = "Notification settings updated.";
  } catch (error) {
    notificationsMessageType.value = "error";
    notificationsMessage.value = String(error?.message || "Unable to update notifications.");
  } finally {
    notificationsMutationPending.value = false;
  }
}

watch(
  () => preferencesForm.avatarSize,
  (nextSize) => {
    profileAvatar.size = normalizeAvatarSize(nextSize || AVATAR_DEFAULT_SIZE);
  },
  { immediate: true }
);

onMounted(async () => {
  setupAvatarUploader();
  await loadSettings();
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
        <v-alert v-if="page.state.loadError" type="error" variant="tonal" class="mb-4">
          {{ page.state.loadError }}
        </v-alert>

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

                      <v-alert
                        v-if="preferences.state.preferencesMessage"
                        :type="preferences.state.preferencesMessageType"
                        variant="tonal"
                        class="mb-3"
                      >
                        {{ preferences.state.preferencesMessage }}
                      </v-alert>

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

                      <v-alert
                        v-if="notifications.state.notificationsMessage"
                        :type="notifications.state.notificationsMessageType"
                        variant="tonal"
                        class="mb-3"
                      >
                        {{ notifications.state.notificationsMessage }}
                      </v-alert>

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
