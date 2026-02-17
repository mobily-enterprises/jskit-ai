import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useTheme } from "vuetify";
import { resolveSurfacePaths } from "../../../shared/routing/surfacePaths.js";
import { api } from "../../services/api";
import { useAuthStore } from "../../stores/authStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useAuthGuard } from "../../composables/useAuthGuard";
import { AVATAR_DEFAULT_SIZE, AVATAR_SIZE_OPTIONS } from "../../../shared/avatar/index.js";
import {
  AUTH_METHOD_KIND_OAUTH,
  AUTH_METHOD_KIND_OTP,
  AUTH_METHOD_KIND_PASSWORD
} from "../../../shared/auth/authMethods.js";
import {
  clearPendingOAuthContext,
  readOAuthCallbackStateFromLocation,
  readPendingOAuthContext,
  stripOAuthCallbackParamsFromLocation
} from "../../utils/oauthCallback.js";
import { useSettingsSecurityLogic } from "./security/useSettingsSecurityLogic";
import { useSettingsProfileLogic } from "./profile/useSettingsProfileLogic";
import { useSettingsPreferencesLogic } from "./preferences/useSettingsPreferencesLogic";
import { useSettingsNotificationsLogic } from "./notifications/useSettingsNotificationsLogic";


export function useSettingsView() {
const SETTINGS_QUERY_KEY = ["settings"];
const SETTINGS_SECTION_QUERY_KEY = "section";
const VALID_TABS = new Set(["profile", "preferences", "security", "notifications"]);
const PASSWORD_FORM_MODE_MANAGE = "manage";
const PASSWORD_FORM_MODE_ENABLE = "enable";
const settingsSections = [
  { title: "Profile", value: "profile" },
  { title: "Preferences", value: "preferences" },
  { title: "Security", value: "security" },
  { title: "Notifications", value: "notifications" }
];

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

const activeTab = ref("profile");
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

const profileLogic = useSettingsProfileLogic({
  profileForm,
  preferencesForm,
  profileAvatar,
  selectedAvatarFileName,
  avatarUppy,
  profileFieldErrors,
  profileMessage,
  profileMessageType,
  avatarMessage,
  avatarMessageType,
  profileMutation,
  avatarDeleteMutation,
  settingsQueryKey: SETTINGS_QUERY_KEY,
  queryClient,
  authStore,
  workspaceStore,
  clearFieldErrors,
  toErrorMessage,
  handleAuthError,
  applySettingsData
});
const {
  profileInitials,
  applyAvatarData,
  setupAvatarUploader,
  submitProfile,
  openAvatarEditor,
  submitAvatarDelete
} = profileLogic;

const preferencesLogic = useSettingsPreferencesLogic({
  vuetifyTheme,
  preferencesForm,
  preferencesFieldErrors,
  preferencesMessage,
  preferencesMessageType,
  preferencesMutation,
  settingsQueryKey: SETTINGS_QUERY_KEY,
  queryClient,
  clearFieldErrors,
  toErrorMessage,
  handleAuthError,
  applySettingsData
});
const { applyThemePreference, submitPreferences } = preferencesLogic;

const notificationsLogic = useSettingsNotificationsLogic({
  notificationsForm,
  notificationsMessage,
  notificationsMessageType,
  notificationsMutation,
  settingsQueryKey: SETTINGS_QUERY_KEY,
  queryClient,
  toErrorMessage,
  handleAuthError,
  applySettingsData
});
const { submitNotifications } = notificationsLogic;

const securityLogic = useSettingsSecurityLogic({
  settingsQuery,
  passwordFormMode,
  showPasswordForm,
  securityForm,
  showCurrentPassword,
  showNewPassword,
  showConfirmPassword,
  securityFieldErrors,
  securityMessage,
  securityMessageType,
  providerMessage,
  providerMessageType,
  providerLinkStartInFlight,
  methodActionLoadingId,
  passwordMutation,
  setPasswordMethodEnabledMutation,
  logoutOthersMutation,
  unlinkProviderMutation,
  sessionsMessage,
  sessionsMessageType,
  queryClient,
  settingsQueryKey: SETTINGS_QUERY_KEY,
  clearFieldErrors,
  toErrorMessage,
  handleAuthError,
  applySettingsData,
  resolveCurrentSettingsPath,
  buildSettingsPathWithTab,
  PASSWORD_FORM_MODE_MANAGE,
  PASSWORD_FORM_MODE_ENABLE
});
const {
  createFallbackAuthMethods,
  normalizeAuthMethod,
  mfaStatus,
  securityStatus,
  securityAuthPolicy,
  securityAuthMethods,
  passwordMethod,
  isPasswordEnableSetupMode,
  requiresCurrentPassword,
  canOpenPasswordManageForm,
  canOpenPasswordEnableSetup,
  canSubmitPasswordForm,
  passwordRequiresExistingSecret,
  passwordSubmitLabel,
  passwordManageLabel,
  passwordDialogTitle,
  passwordFormSubmitLabel,
  passwordFormSubmitPending,
  authMethodItems,
  securityMethodsHint,
  mfaLabel,
  mfaChipColor,
  providerLabel,
  authMethodStatusText,
  submitPasswordChange,
  openPasswordForm,
  openPasswordEnableSetup,
  closePasswordForm,
  submitPasswordMethodToggle,
  startProviderLink,
  submitProviderUnlink,
  submitLogoutOthers
} = securityLogic;

function resolveTabFromSearch(search) {
  const tab = String(search?.[SETTINGS_SECTION_QUERY_KEY] || "").trim().toLowerCase();
  return VALID_TABS.has(tab) ? tab : "profile";
}

function isSettingsRoutePath(pathname) {
  return surfacePaths.value.isAccountSettingsPath(pathname);
}

function resolveCurrentSettingsPath() {
  return isSettingsRoutePath(routerPath.value) ? String(routerPath.value) : "";
}

function resolveSettingsSearchWithTab(tab) {
  const search = {
    [SETTINGS_SECTION_QUERY_KEY]: tab
  };

  const returnTo = String(routerSearch.value?.returnTo || "").trim();
  if (returnTo) {
    search.returnTo = returnTo;
  }

  return search;
}

function selectSettingsSection(nextTab) {
  if (!VALID_TABS.has(nextTab)) {
    return;
  }

  if (activeTab.value === nextTab) {
    return;
  }

  activeTab.value = nextTab;
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

async function handleOAuthCallbackIfPresent() {
  const pendingOAuthContext = readPendingOAuthContext();
  const callbackState = readOAuthCallbackStateFromLocation({
    pendingContext: pendingOAuthContext,
    defaultIntent: "link",
    defaultReturnTo: buildSettingsPathWithTab("profile")
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
      preserveSearchKeys: [SETTINGS_SECTION_QUERY_KEY, "returnTo"]
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
      preserveSearchKeys: [SETTINGS_SECTION_QUERY_KEY, "returnTo"]
    });
  } finally {
    clearPendingOAuthContext();
    providerLinkStartInFlight.value = false;
  }
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

  return {
    meta: {
      AUTH_METHOD_KIND_PASSWORD,
      AUTH_METHOD_KIND_OAUTH,
      AUTH_METHOD_KIND_OTP,
      SETTINGS_QUERY_KEY,
      SETTINGS_SECTION_QUERY_KEY,
      VALID_TABS,
      PASSWORD_FORM_MODE_MANAGE,
      PASSWORD_FORM_MODE_ENABLE,
      settingsSections,
      themeOptions,
      localeOptions,
      dateFormatOptions,
      numberFormatOptions,
      currencyOptions,
      timeZoneOptions,
      avatarSizeOptions,
      createDefaultAvatar
    },
    state: reactive({
      navigate,
      authStore,
      workspaceStore,
      queryClient,
      vuetifyTheme,
      routerSearch,
      routerPath,
      surfacePaths,
      activeTab,
      syncingTabFromUrl,
      settingsEnabled,
      loadError,
      profileForm,
      profileAvatar,
      selectedAvatarFileName,
      avatarUppy,
      preferencesForm,
      notificationsForm,
      securityForm,
      profileFieldErrors,
      preferencesFieldErrors,
      securityFieldErrors,
      profileMessage,
      profileMessageType,
      avatarMessage,
      avatarMessageType,
      preferencesMessage,
      preferencesMessageType,
      notificationsMessage,
      notificationsMessageType,
      securityMessage,
      securityMessageType,
      sessionsMessage,
      sessionsMessageType,
      providerMessage,
      providerMessageType,
      providerLinkStartInFlight,
      methodActionLoadingId,
      showPasswordForm,
      passwordFormMode,
      showCurrentPassword,
      showNewPassword,
      showConfirmPassword,
      settingsQuery,
      profileMutation,
      avatarDeleteMutation,
      preferencesMutation,
      notificationsMutation,
      passwordMutation,
      setPasswordMethodEnabledMutation,
      logoutOthersMutation,
      unlinkProviderMutation,
      mfaStatus,
      securityStatus,
      securityAuthPolicy,
      securityAuthMethods,
      passwordMethod,
      isPasswordEnableSetupMode,
      requiresCurrentPassword,
      canOpenPasswordManageForm,
      canOpenPasswordEnableSetup,
      canSubmitPasswordForm,
      passwordRequiresExistingSecret,
      passwordSubmitLabel,
      passwordManageLabel,
      passwordDialogTitle,
      passwordFormSubmitLabel,
      passwordFormSubmitPending,
      authMethodItems,
      securityMethodsHint,
      mfaLabel,
      mfaChipColor,
      profileInitials,
      backTarget
    }),
    actions: {
      createFallbackAuthMethods,
      normalizeAuthMethod,
      resolveTabFromSearch,
      isSettingsRoutePath,
      resolveCurrentSettingsPath,
      resolveSettingsSearchWithTab,
      selectSettingsSection,
      buildSettingsPathWithTab,
      clearFieldErrors,
      toErrorMessage,
      providerLabel,
      authMethodStatusText,
      handleOAuthCallbackIfPresent,
      applyAvatarData,
      setupAvatarUploader,
      applyThemePreference,
      applySettingsData,
      handleAuthError,
      goBack,
      submitProfile,
      openAvatarEditor,
      submitAvatarDelete,
      submitPreferences,
      submitNotifications,
      submitPasswordChange,
      openPasswordForm,
      openPasswordEnableSetup,
      closePasswordForm,
      submitPasswordMethodToggle,
      startProviderLink,
      submitProviderUnlink,
      submitLogoutOthers
    }
  };
}
