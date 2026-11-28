import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { useTheme } from "vuetify";
import { useRoute } from "vue-router";
import {
  useWebPlacementContext,
  resolveAllowedOriginsFromPlacementContext,
  resolveSurfaceNavigationTargetFromPlacementContext,
  resolveSurfacePathFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { userProfileContract } from "@jskit-ai/users-core/shared/resources/userProfileResource";
import { userSettingsContract } from "@jskit-ai/users-core/shared/resources/userSettingsResource";
import { useAddEdit } from "@jskit-ai/http-web/client/composables/useAddEdit";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useView } from "@jskit-ai/http-web/client/composables/useView";
import {
  persistThemePreference,
  resolveThemeNameForPreference,
  setVuetifyThemeName
} from "../lib/theme.js";
import {
  ACCOUNT_SETTINGS_DEFAULTS,
  AVATAR_DEFAULT_SIZE,
  AVATAR_SIZE_OPTIONS,
  CURRENCY_OPTIONS,
  DATE_FORMAT_OPTIONS,
  NUMBER_FORMAT_OPTIONS,
  THEME_OPTIONS,
  TIME_ZONE_OPTIONS
} from "./account-settings/accountSettingsRuntimeConstants.js";
import {
  normalizeAvatarSize,
  normalizeReturnToPath,
  normalizeSettingsPayload
} from "./account-settings/accountSettingsRuntimeHelpers.js";
import { createAccountSettingsAvatarUploadRuntime } from "./account-settings/accountSettingsAvatarUploadRuntime.js";
import { resolveLocaleOptions, translateOptions } from "./account-settings/accountSettingsPreferenceOptions.js";
import { setAccountLocale } from "../lib/accountLocale.js";
import { useJskitText } from "../i18n.js";

function useAccountSettingsRuntime() {
  const route = useRoute();
  const { context: placementContext } = useWebPlacementContext();
  const queryClient = useQueryClient();
  const errorRuntime = useShellWebErrorRuntime();
  const vuetifyTheme = useTheme();
  const { t } = useJskitText();

  const accountSettingsQueryKey = ["users-web", "settings", "account"];
  const accountProfileWriteQueryKey = ["users-web", "settings", "account-profile-write"];
  const accountPreferencesWriteQueryKey = ["users-web", "settings", "account-preferences-write"];
  const accountNotificationsWriteQueryKey = ["users-web", "settings", "account-notifications-write"];
  const sessionQueryKey = Object.freeze(["users-web", "session", "csrf"]);
  const OWNERSHIP_PUBLIC = ROUTE_VISIBILITY_PUBLIC;
  const USER_SETTINGS_TRANSPORT = Object.freeze({
    kind: "jsonapi-resource",
    responseType: "user-settings",
    responseKind: "record"
  });
  const USER_PROFILE_UPDATE_TRANSPORT = Object.freeze({
    ...USER_SETTINGS_TRANSPORT,
    requestType: "user-profiles"
  });
  const USER_PREFERENCES_UPDATE_TRANSPORT = Object.freeze({
    ...USER_SETTINGS_TRANSPORT,
    requestType: "user-preferences"
  });
  const USER_NOTIFICATION_SETTINGS_UPDATE_TRANSPORT = Object.freeze({
    ...USER_SETTINGS_TRANSPORT,
    requestType: "user-notification-settings"
  });
  const USER_PROFILE_AVATAR_DELETE_TRANSPORT = USER_SETTINGS_TRANSPORT;
  const USER_SECURITY_SETTINGS_TRANSPORT = Object.freeze({
    ...USER_SETTINGS_TRANSPORT,
    responseType: "user-security-settings"
  });

  const accountSettingsPath = computed(() =>
    resolveSurfacePathFromPlacementContext(placementContext.value, "account", "/")
  );
  const allowedReturnToOrigins = computed(() => resolveAllowedOriginsFromPlacementContext(placementContext.value));
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
  // The account's OAuth sign-in methods; canEnable links one and canDisable unlinks it.
  const signInMethodList = ref([]);
  const signInMethodsState = reactive({
    unlinkingProvider: ""
  });
  const savedLocale = ref("");

  const profileInitials = computed(() => {
    const fallback = t("jskit.users.accountSettings.profile.initialsFallback");
    const source = String(profileForm.displayName || profileForm.email || fallback).trim();
    return source.slice(0, 2).toUpperCase() || fallback;
  });

  const themeOptions = computed(() => translateOptions(THEME_OPTIONS));
  const localeOptions = computed(() => resolveLocaleOptions(savedLocale.value));
  const dateFormatOptions = computed(() => translateOptions(DATE_FORMAT_OPTIONS));
  const numberFormatOptions = computed(() => translateOptions(NUMBER_FORMAT_OPTIONS));

  function reportAccountFeedback({
    message,
    severity = "error",
    channel = "",
    dedupeKey = ""
  } = {}) {
    const normalizedMessage = String(message || "").trim();
    if (!normalizedMessage) {
      return;
    }

    errorRuntime.report({
      source: "users-web.account-settings-runtime",
      message: normalizedMessage,
      intent: "action-feedback",
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

  function applySignInMethods(securityStatus) {
    const authMethods = Array.isArray(securityStatus?.authMethods) ? securityStatus.authMethods : [];
    signInMethodList.value = authMethods
      .filter((method) => method?.kind === "oauth" && method.provider)
      .map((method) => Object.freeze({
        provider: String(method.provider),
        label: String(method.label || method.provider),
        linked: method.configured === true,
        canLink: method.canEnable === true,
        canUnlink: method.canDisable === true
      }));
  }

  // Each form's fields from a settings document. Each writes only the record it is given: its form's runtime passes a
  // copy, and gives the form only the fields the person has not changed and not saved.
  function writeProfileFields(target, payload) {
    const data = normalizeSettingsPayload(payload);
    target.displayName = String(data.profile?.displayName || "");
    target.email = String(data.profile?.email || "");
  }

  function writePreferenceFields(target, payload) {
    const data = normalizeSettingsPayload(payload);
    target.theme = String(data.preferences?.theme || ACCOUNT_SETTINGS_DEFAULTS.preferences.theme);
    target.locale = String(data.preferences?.locale || ACCOUNT_SETTINGS_DEFAULTS.preferences.locale);
    target.timeZone = String(data.preferences?.timeZone || ACCOUNT_SETTINGS_DEFAULTS.preferences.timeZone);
    target.dateFormat = String(data.preferences?.dateFormat || ACCOUNT_SETTINGS_DEFAULTS.preferences.dateFormat);
    target.numberFormat = String(data.preferences?.numberFormat || ACCOUNT_SETTINGS_DEFAULTS.preferences.numberFormat);
    target.currencyCode = String(data.preferences?.currencyCode || ACCOUNT_SETTINGS_DEFAULTS.preferences.currencyCode);
    target.avatarSize = normalizeAvatarSize(data.preferences?.avatarSize || ACCOUNT_SETTINGS_DEFAULTS.preferences.avatarSize);
  }

  function writeNotificationFields(target, payload) {
    const data = normalizeSettingsPayload(payload);
    target.productUpdates = Boolean(data.notifications?.productUpdates);
    target.accountActivity = Boolean(data.notifications?.accountActivity);
    target.securityAlerts = ACCOUNT_SETTINGS_DEFAULTS.notifications.securityAlerts;
  }

  // A form's save answers with the whole settings document: it becomes the settings read, which every form then takes.
  function storeSettings(payload) {
    queryClient.setQueryData(accountSettingsQueryKey, payload);
  }

  const profileAddEdit = useAddEdit({
    ownershipFilter: OWNERSHIP_PUBLIC,
    resource: userProfileContract,
    apiSuffix: "/settings/profile",
    queryKeyFactory: () => accountProfileWriteQueryKey,
    readEnabled: false,
    writeMethod: "PATCH",
    transport: USER_PROFILE_UPDATE_TRANSPORT,
    fallbackSaveError: t("jskit.users.accountSettings.profile.saveFailed"),
    fieldErrorKeys: ["displayName"],
    model: profileForm,
    mapLoadedToModel: writeProfileFields,
    onSaveSuccess: storeSettings,
    input: userProfileContract.operations.patch.body,
    buildRawPayload: (model) => ({
      displayName: String(model.displayName || "").trim()
    }),
    messages: {
      saveSuccess: t("jskit.users.accountSettings.profile.saved"),
      saveError: t("jskit.users.accountSettings.profile.saveFailed")
    }
  });

  const avatarDeleteCommand = useCommand({
    ownershipFilter: OWNERSHIP_PUBLIC,
    apiSuffix: "/settings/profile/avatar",
    writeMethod: "DELETE",
    transport: USER_PROFILE_AVATAR_DELETE_TRANSPORT,
    fallbackRunError: t("jskit.users.accountSettings.avatar.removeFailed"),
    model: profileForm,
    onRunSuccess: (payload) => {
      applySettingsData(payload);
      storeSettings(payload);
    },
    messages: {
      success: t("jskit.users.accountSettings.avatar.removed"),
      error: t("jskit.users.accountSettings.avatar.removeFailed")
    }
  });

  const preferencesAddEdit = useAddEdit({
    ownershipFilter: OWNERSHIP_PUBLIC,
    resource: userSettingsContract,
    apiSuffix: "/settings/preferences",
    queryKeyFactory: () => accountPreferencesWriteQueryKey,
    readEnabled: false,
    writeMethod: "PATCH",
    transport: USER_PREFERENCES_UPDATE_TRANSPORT,
    fallbackSaveError: t("jskit.users.accountSettings.preferences.saveFailed"),
    fieldErrorKeys: ["theme", "locale", "timeZone", "dateFormat", "numberFormat", "currencyCode", "avatarSize"],
    model: preferencesForm,
    mapLoadedToModel: writePreferenceFields,
    onSaveSuccess: storeSettings,
    input: userSettingsContract.operations.preferencesUpdate.body,
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
      saveSuccess: t("jskit.users.accountSettings.preferences.saved"),
      saveError: t("jskit.users.accountSettings.preferences.saveFailed")
    }
  });

  const notificationsAddEdit = useAddEdit({
    ownershipFilter: OWNERSHIP_PUBLIC,
    resource: userSettingsContract,
    apiSuffix: "/settings/notifications",
    queryKeyFactory: () => accountNotificationsWriteQueryKey,
    readEnabled: false,
    writeMethod: "PATCH",
    transport: USER_NOTIFICATION_SETTINGS_UPDATE_TRANSPORT,
    fallbackSaveError: t("jskit.users.accountSettings.notifications.saveFailed"),
    model: notificationsForm,
    mapLoadedToModel: writeNotificationFields,
    onSaveSuccess: storeSettings,
    input: userSettingsContract.operations.notificationsUpdate.body,
    buildRawPayload: (model) => ({
      productUpdates: Boolean(model.productUpdates),
      accountActivity: Boolean(model.accountActivity),
      securityAlerts: true
    }),
    messages: {
      saveSuccess: t("jskit.users.accountSettings.notifications.saved"),
      saveError: t("jskit.users.accountSettings.notifications.saveFailed")
    }
  });

  const signInMethodUnlinkCommand = useCommand({
    ownershipFilter: OWNERSHIP_PUBLIC,
    apiSuffix: () => `/settings/security/oauth/${encodeURIComponent(signInMethodsState.unlinkingProvider)}`,
    writeMethod: "DELETE",
    transport: USER_SECURITY_SETTINGS_TRANSPORT,
    fallbackRunError: t("jskit.users.accountSettings.signInMethods.unlinkFailed"),
    model: signInMethodsState,
    onRunSuccess: (payload, { queryClient: commandQueryClient }) => {
      applySignInMethods(payload?.securityStatus);
      commandQueryClient.setQueryData(accountSettingsQueryKey, (current) =>
        current ? { ...current, security: payload?.securityStatus } : current
      );
    },
    messages: {
      success: t("jskit.users.accountSettings.signInMethods.unlinked"),
      error: t("jskit.users.accountSettings.signInMethods.unlinkFailed")
    }
  });

  // A settings document, from the settings read (its first load, a read again on `account.settings.changed` or the
  // window regaining focus, Retry) or a command's answer: each form takes it through its own runtime, which keeps
  // what the person changed and has not saved, and the rest of the page shows what the server holds.
  function applySettingsData(payload) {
    const data = normalizeSettingsPayload(payload);
    profileAddEdit.applyLoaded(data);
    preferencesAddEdit.applyLoaded(data);
    notificationsAddEdit.applyLoaded(data);

    applyAvatarData(data.profile?.avatar);
    applySignInMethods(data.security);
    applyThemePreference(String(data.preferences?.theme || ACCOUNT_SETTINGS_DEFAULTS.preferences.theme));
    if (data.preferences?.locale) {
      savedLocale.value = String(data.preferences.locale);
      setAccountLocale(savedLocale.value);
    }
  }

  const avatarUploadRuntime = createAccountSettingsAvatarUploadRuntime({
    queryClient,
    sessionQueryKey,
    accountSettingsQueryKey,
    selectedAvatarFileName,
    applySettingsData,
    reportAccountFeedback
  });

  const settingsView = useView({
    ownershipFilter: OWNERSHIP_PUBLIC,
    apiSuffix: "/settings",
    queryKeyFactory: () => accountSettingsQueryKey,
    transport: USER_SETTINGS_TRANSPORT,
    realtime: {
      event: "account.settings.changed"
    },
    fallbackLoadError: t("jskit.users.accountSettings.loadFailed"),
    mapLoadedToModel: (_model, payload = {}) => {
      applySettingsData(payload);
    }
  });

  const loadingSettings = computed(() => Boolean(settingsView.isLoading));
  const refreshingSettings = computed(() => Boolean(settingsView.isRefetching));
  const savingProfile = computed(() => Boolean(profileAddEdit.isSaving));
  const deletingAvatar = computed(() => Boolean(avatarDeleteCommand.isRunning));
  const savingPreferences = computed(() => Boolean(preferencesAddEdit.isSaving));
  const savingNotifications = computed(() => Boolean(notificationsAddEdit.isSaving));
  const settingsLoadError = computed(() => String(settingsView.loadError || "").trim());

  async function refreshSettings() {
    return settingsView.refresh();
  }

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

  // Linking leaves the app for the provider and returns to this page.
  function linkSignInMethod(provider) {
    const params = new URLSearchParams({ returnTo: route?.fullPath || accountSettingsPath.value });
    window.location.assign(`/api/settings/security/oauth/${encodeURIComponent(provider)}/start?${params}`);
  }

  async function unlinkSignInMethod(provider) {
    signInMethodsState.unlinkingProvider = String(provider || "");
    try {
      await signInMethodUnlinkCommand.run();
    } catch {
      // Error feedback is already handled in useCommand.
    } finally {
      signInMethodsState.unlinkingProvider = "";
    }
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

  const profile = {
    form: profileForm,
    avatar: profileAvatar,
    initials: profileInitials,
    selectedAvatarFileName,
    fieldErrors: profileAddEdit.fieldErrors,
    // The fields whose server value changed while the person was editing them, and their choice for each.
    conflicts: computed(() => profileAddEdit.conflicts),
    acceptServerValue: profileAddEdit.acceptServerValue,
    keepOwnValue: profileAddEdit.keepOwnValue,
    isSaving: savingProfile,
    isDeletingAvatar: deletingAvatar,
    isRefreshing: refreshingSettings,
    submit: submitProfile,
    openAvatarEditor,
    removeAvatar: submitAvatarDelete
  };

  const preferences = {
    form: preferencesForm,
    fieldErrors: preferencesAddEdit.fieldErrors,
    conflicts: computed(() => preferencesAddEdit.conflicts),
    acceptServerValue: preferencesAddEdit.acceptServerValue,
    keepOwnValue: preferencesAddEdit.keepOwnValue,
    isSaving: savingPreferences,
    isRefreshing: refreshingSettings,
    // Plain arrays for v-select items; the getters follow the active language.
    options: Object.freeze({
      get theme() {
        return themeOptions.value;
      },
      get locale() {
        return localeOptions.value;
      },
      timeZone: TIME_ZONE_OPTIONS,
      get dateFormat() {
        return dateFormatOptions.value;
      },
      get numberFormat() {
        return numberFormatOptions.value;
      },
      currency: CURRENCY_OPTIONS,
      avatarSize: AVATAR_SIZE_OPTIONS
    }),
    submit: submitPreferences
  };

  const notifications = {
    form: notificationsForm,
    conflicts: computed(() => notificationsAddEdit.conflicts),
    acceptServerValue: notificationsAddEdit.acceptServerValue,
    keepOwnValue: notificationsAddEdit.keepOwnValue,
    isSaving: savingNotifications,
    isRefreshing: refreshingSettings,
    submit: submitNotifications
  };

  const signInMethods = {
    methods: signInMethodList,
    unlinkingProvider: computed(() => signInMethodsState.unlinkingProvider),
    isRefreshing: refreshingSettings,
    link: linkSignInMethod,
    unlink: unlinkSignInMethod
  };

  return {
    backTarget,
    backNavigationTarget,
    loadingSettings,
    refreshingSettings,
    settingsLoadError,
    refreshSettings,
    profile,
    preferences,
    notifications,
    signInMethods
  };
}

export { useAccountSettingsRuntime };
