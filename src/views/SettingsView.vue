<template>
  <section class="settings-view py-2 py-md-4">
    <v-card class="panel-card" rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="panel-title">User settings</v-card-title>
        <v-card-subtitle>Account security, profile, preferences, and notification controls.</v-card-subtitle>
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
                    <v-card-title class="text-subtitle-1">Change password</v-card-title>
                  </v-card-item>
                  <v-divider />
                  <v-card-text>
                    <v-form @submit.prevent="submitPasswordChange" novalidate>
                      <v-text-field
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

                      <v-btn type="submit" color="primary" :loading="passwordMutation.isPending.value">Update password</v-btn>
                    </v-form>
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
                        v-model="preferencesForm.defaultMode"
                        label="Default mode"
                        :items="modeOptions"
                        item-title="title"
                        item-value="value"
                        variant="outlined"
                        density="comfortable"
                      />
                    </v-col>
                    <v-col cols="12" md="3">
                      <v-select
                        v-model="preferencesForm.defaultTiming"
                        label="Default timing"
                        :items="timingOptions"
                        item-title="title"
                        item-value="value"
                        variant="outlined"
                        density="comfortable"
                      />
                    </v-col>
                    <v-col cols="12" md="3">
                      <v-text-field
                        v-model.number="preferencesForm.defaultPaymentsPerYear"
                        label="Default payments/year"
                        type="number"
                        min="1"
                        max="365"
                        step="1"
                        variant="outlined"
                        density="comfortable"
                        :error-messages="
                          preferencesFieldErrors.defaultPaymentsPerYear ? [preferencesFieldErrors.defaultPaymentsPerYear] : []
                        "
                      />
                    </v-col>
                    <v-col cols="12" md="3">
                      <v-select
                        v-model.number="preferencesForm.defaultHistoryPageSize"
                        label="Default history rows"
                        :items="historyPageSizeOptions"
                        variant="outlined"
                        density="comfortable"
                        :error-messages="
                          preferencesFieldErrors.defaultHistoryPageSize ? [preferencesFieldErrors.defaultHistoryPageSize] : []
                        "
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
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useTheme } from "vuetify";
import { api } from "../services/api";
import { useAuthStore } from "../stores/authStore";

const SETTINGS_QUERY_KEY = ["settings"];
const VALID_TABS = new Set(["security", "profile", "preferences", "notifications"]);

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
const modeOptions = [
  { title: "Future value", value: "fv" },
  { title: "Present value", value: "pv" }
];
const timingOptions = [
  { title: "Ordinary", value: "ordinary" },
  { title: "Due", value: "due" }
];
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
const historyPageSizeOptions = [10, 25, 50, 100];

const navigate = useNavigate();
const authStore = useAuthStore();
const queryClient = useQueryClient();
const vuetifyTheme = useTheme();

const routerSearch = useRouterState({
  select: (state) => state.location.search
});

const activeTab = ref("preferences");
const settingsEnabled = ref(false);
const loadError = ref("");

const profileForm = reactive({
  displayName: "",
  email: ""
});

const preferencesForm = reactive({
  theme: "system",
  locale: "en-US",
  timeZone: "UTC",
  dateFormat: "system",
  numberFormat: "system",
  currencyCode: "USD",
  defaultMode: "fv",
  defaultTiming: "ordinary",
  defaultPaymentsPerYear: 12,
  defaultHistoryPageSize: 10
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
  defaultPaymentsPerYear: "",
  defaultHistoryPageSize: ""
});
const securityFieldErrors = reactive({
  currentPassword: "",
  newPassword: "",
  confirmPassword: ""
});

const profileMessage = ref("");
const profileMessageType = ref("success");
const preferencesMessage = ref("");
const preferencesMessageType = ref("success");
const notificationsMessage = ref("");
const notificationsMessageType = ref("success");
const securityMessage = ref("");
const securityMessageType = ref("success");
const sessionsMessage = ref("");
const sessionsMessageType = ref("success");

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

const preferencesMutation = useMutation({
  mutationFn: (payload) => api.updatePreferencesSettings(payload)
});

const notificationsMutation = useMutation({
  mutationFn: (payload) => api.updateNotificationSettings(payload)
});

const passwordMutation = useMutation({
  mutationFn: (payload) => api.changePassword(payload)
});

const logoutOthersMutation = useMutation({
  mutationFn: () => api.logoutOtherSessions()
});

const mfaStatus = computed(() => String(settingsQuery.data.value?.security?.mfa?.status || "not_enabled"));
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

function resolveTabFromSearch(search) {
  const tab = String(search?.tab || "").trim().toLowerCase();
  return VALID_TABS.has(tab) ? tab : "preferences";
}

function clearFieldErrors(target) {
  for (const key of Object.keys(target)) {
    target[key] = "";
  }
}

function toErrorMessage(error, fallback) {
  if (error?.fieldErrors && typeof error.fieldErrors === "object") {
    const details = Object.values(error.fieldErrors)
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    if (details.length > 0) {
      return details.join(" ");
    }
  }

  return String(error?.message || fallback);
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

  preferencesForm.theme = String(data.preferences?.theme || "system");
  preferencesForm.locale = String(data.preferences?.locale || "en-US");
  preferencesForm.timeZone = String(data.preferences?.timeZone || "UTC");
  preferencesForm.dateFormat = String(data.preferences?.dateFormat || "system");
  preferencesForm.numberFormat = String(data.preferences?.numberFormat || "system");
  preferencesForm.currencyCode = String(data.preferences?.currencyCode || "USD");
  preferencesForm.defaultMode = String(data.preferences?.defaultMode || "fv");
  preferencesForm.defaultTiming = String(data.preferences?.defaultTiming || "ordinary");
  preferencesForm.defaultPaymentsPerYear = Number(data.preferences?.defaultPaymentsPerYear || 12);
  preferencesForm.defaultHistoryPageSize = Number(data.preferences?.defaultHistoryPageSize || 10);

  notificationsForm.productUpdates = Boolean(data.notifications?.productUpdates);
  notificationsForm.accountActivity = Boolean(data.notifications?.accountActivity);
  notificationsForm.securityAlerts = true;

  applyThemePreference(preferencesForm.theme);
}

async function redirectToLogin() {
  await navigate({ to: "/login", replace: true });
}

function handleAuthError(error) {
  if (Number(error?.status) === 401) {
    authStore.setSignedOut();
    redirectToLogin();
    return true;
  }

  return false;
}

watch(
  () => settingsQuery.error.value,
  (error) => {
    if (!error) {
      loadError.value = "";
      return;
    }

    if (handleAuthError(error)) {
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
  () => routerSearch.value,
  (search) => {
    activeTab.value = resolveTabFromSearch(search);
  },
  { immediate: true }
);

watch(activeTab, async (nextTab) => {
  if (!VALID_TABS.has(nextTab)) {
    return;
  }

  await navigate({
    to: "/settings",
    search: {
      tab: nextTab
    },
    replace: true
  });
});

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
    if (handleAuthError(error)) {
      return;
    }

    if (error?.fieldErrors?.displayName) {
      profileFieldErrors.displayName = String(error.fieldErrors.displayName);
    }

    profileMessageType.value = "error";
    profileMessage.value = toErrorMessage(error, "Unable to update profile.");
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
      defaultMode: preferencesForm.defaultMode,
      defaultTiming: preferencesForm.defaultTiming,
      defaultPaymentsPerYear: Number(preferencesForm.defaultPaymentsPerYear),
      defaultHistoryPageSize: Number(preferencesForm.defaultHistoryPageSize)
    });

    queryClient.setQueryData(SETTINGS_QUERY_KEY, data);
    applySettingsData(data);
    preferencesMessageType.value = "success";
    preferencesMessage.value = "Preferences updated.";
  } catch (error) {
    if (handleAuthError(error)) {
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
    if (handleAuthError(error)) {
      return;
    }

    notificationsMessageType.value = "error";
    notificationsMessage.value = toErrorMessage(error, "Unable to update notifications.");
  }
}

async function submitPasswordChange() {
  clearFieldErrors(securityFieldErrors);
  securityMessage.value = "";

  try {
    const response = await passwordMutation.mutateAsync({
      currentPassword: securityForm.currentPassword,
      newPassword: securityForm.newPassword,
      confirmPassword: securityForm.confirmPassword
    });

    securityForm.currentPassword = "";
    securityForm.newPassword = "";
    securityForm.confirmPassword = "";
    securityMessageType.value = "success";
    securityMessage.value = String(response?.message || "Password changed.");
  } catch (error) {
    if (handleAuthError(error)) {
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
    securityMessage.value = toErrorMessage(error, "Unable to change password.");
  }
}

async function submitLogoutOthers() {
  sessionsMessage.value = "";

  try {
    const response = await logoutOthersMutation.mutateAsync();
    sessionsMessageType.value = "success";
    sessionsMessage.value = String(response?.message || "Signed out from other active sessions.");
  } catch (error) {
    if (handleAuthError(error)) {
      return;
    }

    sessionsMessageType.value = "error";
    sessionsMessage.value = toErrorMessage(error, "Unable to sign out other sessions.");
  }
}

onMounted(() => {
  settingsEnabled.value = true;
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
