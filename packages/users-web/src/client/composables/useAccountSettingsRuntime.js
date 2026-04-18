import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { useTheme } from "vuetify";
import { useRoute } from "vue-router";
import {
  useWebPlacementContext,
  resolveSurfaceNavigationTargetFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { userProfileResource } from "@jskit-ai/users-core/shared/resources/userProfileResource";
import { userSettingsResource } from "@jskit-ai/users-core/shared/resources/userSettingsResource";
import {
  persistThemePreference,
  resolveThemeNameForPreference,
  setVuetifyThemeName
} from "../lib/theme.js";
import { useAddEdit } from "./records/useAddEdit.js";
import { useCommand } from "./useCommand.js";
import { useView } from "./records/useView.js";
import { resolveSurfacePathFromPlacementContext } from "@jskit-ai/shell-web/client/placement";
import {
  ACCOUNT_SETTINGS_DEFAULTS,
  AVATAR_DEFAULT_SIZE,
  AVATAR_SIZE_OPTIONS,
  CURRENCY_OPTIONS,
  DATE_FORMAT_OPTIONS,
  LOCALE_OPTIONS,
  NUMBER_FORMAT_OPTIONS,
  THEME_OPTIONS,
  TIME_ZONE_OPTIONS
} from "./account-settings/accountSettingsRuntimeConstants.js";
import {
  normalizeAvatarSize,
  normalizeReturnToPath,
  normalizeSettingsPayload,
  resolveAllowedReturnToOrigins
} from "./account-settings/accountSettingsRuntimeHelpers.js";
import { createAccountSettingsAvatarUploadRuntime } from "./account-settings/accountSettingsAvatarUploadRuntime.js";

function useAccountSettingsRuntime() {
  const route = useRoute();
  const { context: placementContext } = useWebPlacementContext();
  const queryClient = useQueryClient();
  const errorRuntime = useShellWebErrorRuntime();
  const vuetifyTheme = useTheme();

  const accountSettingsQueryKey = ["users-web", "settings", "account"];
  const accountProfileWriteQueryKey = ["users-web", "settings", "account-profile-write"];
  const accountPreferencesWriteQueryKey = ["users-web", "settings", "account-preferences-write"];
  const accountNotificationsWriteQueryKey = ["users-web", "settings", "account-notifications-write"];
  const sessionQueryKey = Object.freeze(["users-web", "session", "csrf"]);
  const OWNERSHIP_PUBLIC = ROUTE_VISIBILITY_PUBLIC;

  const accountSettingsPath = computed(() =>
    resolveSurfacePathFromPlacementContext(placementContext.value, "account", "/")
  );
  const allowedReturnToOrigins = computed(() => resolveAllowedReturnToOrigins(placementContext.value));
  const backTarget = computed(() =>
    normalizeReturnToPath(route?.query?.returnTo, {
      fallback: "/",
      accountSettingsPath: accountSettingsPath.value,
      allowedOrigins: allowedReturnToOrigins.value
    })
  );
  const backNavigationTarget = computed(() =>
    resolveSurfaceNavigationTargetFromPlacementContext(placementContext.value, {
      path: backTarget.value
    })
  );

  const profileForm = reactive({
    displayName: "",
    email: ""
  });

  const preferencesForm = reactive({
    theme: ACCOUNT_SETTINGS_DEFAULTS.preferences.theme,
    locale: ACCOUNT_SETTINGS_DEFAULTS.preferences.locale,
    timeZone: ACCOUNT_SETTINGS_DEFAULTS.preferences.timeZone,
    dateFormat: ACCOUNT_SETTINGS_DEFAULTS.preferences.dateFormat,
    numberFormat: ACCOUNT_SETTINGS_DEFAULTS.preferences.numberFormat,
    currencyCode: ACCOUNT_SETTINGS_DEFAULTS.preferences.currencyCode,
    avatarSize: ACCOUNT_SETTINGS_DEFAULTS.preferences.avatarSize
  });

  const notificationsForm = reactive({
    productUpdates: ACCOUNT_SETTINGS_DEFAULTS.notifications.productUpdates,
    accountActivity: ACCOUNT_SETTINGS_DEFAULTS.notifications.accountActivity,
    securityAlerts: ACCOUNT_SETTINGS_DEFAULTS.notifications.securityAlerts
  });

  const profileAvatar = reactive({
    uploadedUrl: null,
    gravatarUrl: "",
    effectiveUrl: "",
    hasUploadedAvatar: false,
    size: ACCOUNT_SETTINGS_DEFAULTS.preferences.avatarSize,
    version: null
  });

  const selectedAvatarFileName = ref("");

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
      source: "users-web.account-settings-runtime",
      message: normalizedMessage,
      severity,
      channel,
      dedupeKey: dedupeKey || `users-web.account-settings-runtime:${severity}:${normalizedMessage}`,
      dedupeWindowMs: 3000
    });
  }

  function applyThemePreference(themePreference) {
    const themeName = resolveThemeNameForPreference(themePreference);
    setVuetifyThemeName(vuetifyTheme, themeName);
    persistThemePreference(themePreference);
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

    preferencesForm.theme = String(data.preferences?.theme || ACCOUNT_SETTINGS_DEFAULTS.preferences.theme);
    preferencesForm.locale = String(data.preferences?.locale || ACCOUNT_SETTINGS_DEFAULTS.preferences.locale);
    preferencesForm.timeZone = String(data.preferences?.timeZone || ACCOUNT_SETTINGS_DEFAULTS.preferences.timeZone);
    preferencesForm.dateFormat = String(data.preferences?.dateFormat || ACCOUNT_SETTINGS_DEFAULTS.preferences.dateFormat);
    preferencesForm.numberFormat = String(data.preferences?.numberFormat || ACCOUNT_SETTINGS_DEFAULTS.preferences.numberFormat);
    preferencesForm.currencyCode = String(data.preferences?.currencyCode || ACCOUNT_SETTINGS_DEFAULTS.preferences.currencyCode);
    preferencesForm.avatarSize = normalizeAvatarSize(data.preferences?.avatarSize || ACCOUNT_SETTINGS_DEFAULTS.preferences.avatarSize);

    notificationsForm.productUpdates = Boolean(data.notifications?.productUpdates);
    notificationsForm.accountActivity = Boolean(data.notifications?.accountActivity);
    notificationsForm.securityAlerts = ACCOUNT_SETTINGS_DEFAULTS.notifications.securityAlerts;

    applyThemePreference(preferencesForm.theme);
  }

  const avatarUploadRuntime = createAccountSettingsAvatarUploadRuntime({
    queryClient,
    sessionQueryKey,
    accountSettingsQueryKey,
    selectedAvatarFileName,
    applySettingsData,
    reportAccountFeedback
  });

  const mapAccountSettingsPayload = (_model, payload = {}) => {
    applySettingsData(payload);
  };

  const settingsView = useView({
    ownershipFilter: OWNERSHIP_PUBLIC,
    apiSuffix: "/settings",
    queryKeyFactory: () => accountSettingsQueryKey,
    realtime: {
      event: "account.settings.changed"
    },
    fallbackLoadError: "Unable to load settings.",
    mapLoadedToModel: mapAccountSettingsPayload
  });

  const profileAddEdit = useAddEdit({
    ownershipFilter: OWNERSHIP_PUBLIC,
    resource: userProfileResource,
    apiSuffix: "/settings/profile",
    queryKeyFactory: () => accountProfileWriteQueryKey,
    readEnabled: false,
    writeMethod: "PATCH",
    fallbackSaveError: "Unable to update profile.",
    fieldErrorKeys: ["displayName"],
    model: profileForm,
    mapLoadedToModel: mapAccountSettingsPayload,
    parseInput: (rawPayload) =>
      validateOperationSection({
        operation: userProfileResource.operations.patch,
        section: "bodyValidator",
        value: rawPayload
      }),
    buildRawPayload: (model) => ({
      displayName: String(model.displayName || "").trim()
    }),
    messages: {
      saveSuccess: "Profile updated.",
      saveError: "Unable to update profile."
    }
  });

  const avatarDeleteCommand = useCommand({
    ownershipFilter: OWNERSHIP_PUBLIC,
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
    ownershipFilter: OWNERSHIP_PUBLIC,
    resource: userSettingsResource,
    apiSuffix: "/settings/preferences",
    queryKeyFactory: () => accountPreferencesWriteQueryKey,
    readEnabled: false,
    writeMethod: "PATCH",
    fallbackSaveError: "Unable to update preferences.",
    fieldErrorKeys: ["theme", "locale", "timeZone", "dateFormat", "numberFormat", "currencyCode", "avatarSize"],
    model: preferencesForm,
    mapLoadedToModel: mapAccountSettingsPayload,
    parseInput: (rawPayload) =>
      validateOperationSection({
        operation: userSettingsResource.operations.preferencesUpdate,
        section: "bodyValidator",
        value: rawPayload
      }),
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
    ownershipFilter: OWNERSHIP_PUBLIC,
    resource: userSettingsResource,
    apiSuffix: "/settings/notifications",
    queryKeyFactory: () => accountNotificationsWriteQueryKey,
    readEnabled: false,
    writeMethod: "PATCH",
    fallbackSaveError: "Unable to update notifications.",
    model: notificationsForm,
    mapLoadedToModel: mapAccountSettingsPayload,
    parseInput: (rawPayload) =>
      validateOperationSection({
        operation: userSettingsResource.operations.notificationsUpdate,
        section: "bodyValidator",
        value: rawPayload
      }),
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

  const loadingSettings = computed(() => Boolean(settingsView.isLoading));
  const refreshingSettings = computed(() => Boolean(settingsView.isRefetching));
  async function submitProfile() {
    await profileAddEdit.submit();
  }

  function openAvatarEditor() {
    avatarUploadRuntime.openEditor();
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
    avatarUploadRuntime.setup();
  });

  onBeforeUnmount(() => {
    avatarUploadRuntime.destroy();
  });

  const profile = Object.freeze({
    form: profileForm,
    avatar: profileAvatar,
    initials: profileInitials,
    selectedAvatarFileName,
    fieldErrors: profileAddEdit.fieldErrors,
    isSaving: profileAddEdit.isSaving,
    isDeletingAvatar: avatarDeleteCommand.isRunning,
    isRefreshing: refreshingSettings,
    submit: submitProfile,
    openAvatarEditor,
    removeAvatar: submitAvatarDelete
  });

  const preferences = Object.freeze({
    form: preferencesForm,
    fieldErrors: preferencesAddEdit.fieldErrors,
    isSaving: preferencesAddEdit.isSaving,
    isRefreshing: refreshingSettings,
    options: Object.freeze({
      theme: THEME_OPTIONS,
      locale: LOCALE_OPTIONS,
      timeZone: TIME_ZONE_OPTIONS,
      dateFormat: DATE_FORMAT_OPTIONS,
      numberFormat: NUMBER_FORMAT_OPTIONS,
      currency: CURRENCY_OPTIONS,
      avatarSize: AVATAR_SIZE_OPTIONS
    }),
    submit: submitPreferences
  });

  const notifications = Object.freeze({
    form: notificationsForm,
    isSaving: notificationsAddEdit.isSaving,
    isRefreshing: refreshingSettings,
    submit: submitNotifications
  });

  return Object.freeze({
    backTarget,
    backNavigationTarget,
    loadingSettings,
    refreshingSettings,
    profile,
    preferences,
    notifications
  });
}

export { useAccountSettingsRuntime };
