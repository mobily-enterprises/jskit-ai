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
import { resolveSurfacePaths } from "../../../shared/routing/surfacePaths.js";
import { api } from "../../services/api";
import { useAuthStore } from "../../stores/authStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useAuthGuard } from "../../composables/useAuthGuard";
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_DEFAULT_SIZE,
  AVATAR_MAX_UPLOAD_BYTES,
  AVATAR_SIZE_OPTIONS
} from "../../../shared/avatar/index.js";
import {
  AUTH_METHOD_DEFINITIONS,
  AUTH_METHOD_KIND_OAUTH,
  AUTH_METHOD_KIND_OTP,
  AUTH_METHOD_KIND_PASSWORD,
  AUTH_METHOD_PASSWORD_ID,
  buildOAuthMethodId
} from "../../../shared/auth/authMethods.js";
import { AUTH_OAUTH_PROVIDER_METADATA, normalizeOAuthProvider } from "../../../shared/auth/oauthProviders.js";
import {
  clearPendingOAuthContext,
  readOAuthCallbackStateFromLocation,
  readPendingOAuthContext,
  stripOAuthCallbackParamsFromLocation,
  writePendingOAuthContext
} from "../../utils/oauthCallback.js";


export function useSettingsView() {
const SETTINGS_QUERY_KEY = ["settings"];
const SETTINGS_SECTION_QUERY_KEY = "section";
const VALID_TABS = new Set(["security", "profile", "preferences", "notifications"]);
const PASSWORD_FORM_MODE_MANAGE = "manage";
const PASSWORD_FORM_MODE_ENABLE = "enable";
const settingsSections = [
  { title: "Security", value: "security" },
  { title: "Profile", value: "profile" },
  { title: "Preferences", value: "preferences" },
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
  const tab = String(search?.[SETTINGS_SECTION_QUERY_KEY] || "").trim().toLowerCase();
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
