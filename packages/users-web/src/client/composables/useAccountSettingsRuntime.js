import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { useTheme } from "vuetify";
import { useRoute, useRouter } from "vue-router";
import {
  useWebPlacementContext,
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceNavigationTargetFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import Uppy from "@uppy/core";
import Dashboard from "@uppy/dashboard";
import ImageEditor from "@uppy/image-editor";
import Compressor from "@uppy/compressor";
import XHRUpload from "@uppy/xhr-upload";
import "@uppy/core/css/style.min.css";
import "@uppy/dashboard/css/style.min.css";
import "@uppy/image-editor/css/style.min.css";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { resolveFieldErrors } from "@jskit-ai/http-runtime/client";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { userProfileResource } from "@jskit-ai/users-core/shared/resources/userProfileResource";
import { userSettingsResource } from "@jskit-ai/users-core/shared/resources/userSettingsResource";
import { usersWebHttpClient } from "../lib/httpClient.js";
import {
  resolveThemeNameForPreference,
  setVuetifyThemeName
} from "../lib/theme.js";
import {
  resolveSurfaceSwitchTargetsFromPlacementContext,
  surfaceRequiresWorkspaceFromPlacementContext
} from "../lib/workspaceSurfaceContext.js";
import { useAddEdit } from "./useAddEdit.js";
import { useCommand } from "./useCommand.js";
import { useView } from "./useView.js";
import { usePaths } from "./usePaths.js";
import {
  ACCOUNT_SETTINGS_CHANGED_EVENT,
  WORKSPACE_PENDING_INVITATIONS_CHANGED_EVENT
} from "@jskit-ai/users-core/shared/events/usersEvents";
import { resolveAccountSettingsPathFromPlacementContext } from "../lib/workspaceSurfacePaths.js";

const AVATAR_ALLOWED_MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);
const AVATAR_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const AVATAR_DEFAULT_SIZE = 64;

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

function normalizeReturnToPath(value, { fallback = "/", accountSettingsPath = "/account/settings", allowedOrigins = [] } = {}) {
  const source = Array.isArray(value) ? value[0] : value;
  const rawValue = String(source || "").trim();
  if (!rawValue) {
    return fallback;
  }

  const normalizedAccountPathname =
    String(accountSettingsPath || "")
      .split("?")[0]
      .split("#")[0]
      .replace(/\/{2,}/g, "/")
      .replace(/\/+$/, "") || "/";

  if (rawValue.startsWith("/") && !rawValue.startsWith("//")) {
    const normalizedPathname = rawValue.split("?")[0].split("#")[0].replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
    if (normalizedPathname === normalizedAccountPathname) {
      return fallback;
    }
    return rawValue;
  }

  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    return fallback;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return fallback;
  }

  if (allowedOrigins.length > 0 && !allowedOrigins.includes(parsed.origin)) {
    return fallback;
  }

  const normalizedPathname = String(parsed.pathname || "").replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
  if (normalizedPathname === normalizedAccountPathname) {
    return fallback;
  }

  return parsed.toString();
}

function normalizeHttpOrigin(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }

  try {
    const parsed = new URL(rawValue);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return parsed.origin;
  } catch {
    return "";
  }
}

function resolveAllowedReturnToOrigins(contextValue = null) {
  const resolvedOrigins = [];

  if (typeof window === "object" && window?.location?.origin) {
    const currentOrigin = normalizeHttpOrigin(window.location.origin);
    if (currentOrigin) {
      resolvedOrigins.push(currentOrigin);
    }
  }

  const surfaceConfig =
    contextValue && typeof contextValue === "object" && contextValue.surfaceConfig && typeof contextValue.surfaceConfig === "object"
      ? contextValue.surfaceConfig
      : {};
  const surfacesById =
    surfaceConfig.surfacesById && typeof surfaceConfig.surfacesById === "object" ? surfaceConfig.surfacesById : {};

  for (const definition of Object.values(surfacesById)) {
    if (!definition || typeof definition !== "object") {
      continue;
    }
    const surfaceOrigin = normalizeHttpOrigin(definition.origin);
    if (!surfaceOrigin || resolvedOrigins.includes(surfaceOrigin)) {
      continue;
    }
    resolvedOrigins.push(surfaceOrigin);
  }

  return resolvedOrigins;
}

function normalizeSettingsPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function normalizePendingInvite(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const id = Number(entry.id);
  const workspaceId = Number(entry.workspaceId);
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(workspaceId) || workspaceId < 1) {
    return null;
  }

  const workspaceSlug = String(entry.workspaceSlug || "").trim();
  if (!workspaceSlug) {
    return null;
  }

  const token = String(entry.token || "").trim();
  if (!token) {
    return null;
  }

  return {
    id,
    token,
    workspaceId,
    workspaceSlug,
    workspaceName: String(entry.workspaceName || workspaceSlug).trim() || workspaceSlug,
    roleId: String(entry.roleId || "member").trim().toLowerCase() || "member",
    status: String(entry.status || "pending").trim().toLowerCase() || "pending",
    expiresAt: String(entry.expiresAt || "").trim()
  };
}

function normalizeAvatarSize(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    return DEFAULTS.preferences.avatarSize;
  }

  const clamped = Math.min(128, Math.max(32, numeric));
  return clamped;
}

function resolveErrorStatusCode(error) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  return Number.isInteger(statusCode) && statusCode > 0 ? statusCode : 0;
}

function useAccountSettingsRuntime() {
  const route = useRoute();
  const router = useRouter();
  const { context: placementContext } = useWebPlacementContext();
  const paths = usePaths();
  const queryClient = useQueryClient();
  const errorRuntime = useShellWebErrorRuntime();
  const vuetifyTheme = useTheme();

  const accountSettingsQueryKey = ["users-web", "settings", "account"];
  const pendingInvitesQueryKey = ["users-web", "settings", "pending-invites"];
  const sessionQueryKey = Object.freeze(["users-web", "session", "csrf"]);

  const accountSettingsPath = computed(() => resolveAccountSettingsPathFromPlacementContext(placementContext.value));
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

  const pendingInvitesModel = reactive({
    pendingInvites: [],
    workspaceInvitesEnabled: false
  });

  const selectedAvatarFileName = ref("");
  let avatarUppy = null;
  const inviteAction = ref({
    token: "",
    decision: ""
  });
  const redeemInviteModel = reactive({
    token: "",
    decision: ""
  });

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

  const pendingInvitesView = useView({
    visibility: "public",
    apiSuffix: "/bootstrap",
    queryKeyFactory: () => pendingInvitesQueryKey,
    realtime: {
      event: WORKSPACE_PENDING_INVITATIONS_CHANGED_EVENT
    },
    fallbackLoadError: "Unable to load invitations.",
    model: pendingInvitesModel,
    mapLoadedToModel: (model, payload = {}) => {
      model.workspaceInvitesEnabled = payload?.app?.features?.workspaceInvites === true;
      model.pendingInvites = model.workspaceInvitesEnabled
        ? (Array.isArray(payload?.pendingInvites) ? payload.pendingInvites : [])
          .map(normalizePendingInvite)
          .filter(Boolean)
        : [];
    }
  });

  const redeemInviteCommand = useCommand({
    visibility: "public",
    apiSuffix: "/workspace/invitations/redeem",
    writeMethod: "POST",
    fallbackRunError: "Unable to respond to invitation.",
    suppressSuccessMessage: true,
    model: redeemInviteModel,
    buildRawPayload: (model) => ({
      token: String(model.token || "").trim(),
      decision: String(model.decision || "").trim().toLowerCase()
    }),
    messages: {
      error: "Unable to respond to invitation."
    }
  });

  const profileAddEdit = useAddEdit({
    visibility: "public",
    resource: userProfileResource,
    apiSuffix: "/settings/profile",
    queryKeyFactory: () => accountSettingsQueryKey,
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
    resource: userSettingsResource,
    apiSuffix: "/settings/preferences",
    queryKeyFactory: () => accountSettingsQueryKey,
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
    visibility: "public",
    resource: userSettingsResource,
    apiSuffix: "/settings/notifications",
    queryKeyFactory: () => accountSettingsQueryKey,
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

  const loadingSettings = computed(() => Boolean(settingsView.isLoading.value));
  const invitesAvailable = computed(() => pendingInvitesModel.workspaceInvitesEnabled === true);
  const loadingInvites = computed(() => invitesAvailable.value && Boolean(pendingInvitesView.isLoading.value));
  const pendingInvites = computed(() => {
    return Array.isArray(pendingInvitesModel.pendingInvites) ? pendingInvitesModel.pendingInvites : [];
  });
  const isResolvingInvite = computed(() => Boolean(redeemInviteCommand.isRunning.value));

  function resolveCurrentPathname() {
    const routePath = String(route?.path || "").trim();
    if (routePath) {
      return routePath;
    }

    if (typeof window === "object" && window?.location?.pathname) {
      return String(window.location.pathname);
    }

    return "/";
  }

  const currentSurfaceId = computed(() => {
    return resolveSurfaceIdFromPlacementPathname(placementContext.value, resolveCurrentPathname());
  });

  const workspaceSurfaceId = computed(() => {
    const surfaceId = String(currentSurfaceId.value || "").trim().toLowerCase();
    if (surfaceId && surfaceRequiresWorkspaceFromPlacementContext(placementContext.value, surfaceId)) {
      return surfaceId;
    }

    const targets = resolveSurfaceSwitchTargetsFromPlacementContext(placementContext.value, surfaceId);
    return String(targets.workspaceSurfaceId || "").trim().toLowerCase();
  });

  function workspaceHomePath(workspaceSlug) {
    const normalizedSlug = String(workspaceSlug || "").trim();
    if (!normalizedSlug || !workspaceSurfaceId.value) {
      return "";
    }

    return paths.page("/", {
      surface: workspaceSurfaceId.value,
      workspaceSlug: normalizedSlug,
      mode: "workspace"
    });
  }

  async function submitProfile() {
    await profileAddEdit.submit();
  }

  async function openWorkspace(workspaceSlug) {
    const targetPath = workspaceHomePath(workspaceSlug);
    if (!targetPath) {
      reportAccountFeedback({
        message: "Workspace surface is not configured.",
        severity: "error",
        channel: "banner",
        dedupeKey: "users-web.account-settings-runtime:workspace-surface-missing"
      });
      return;
    }

    try {
      const navigationTarget = resolveSurfaceNavigationTargetFromPlacementContext(placementContext.value, {
        path: targetPath,
        surfaceId: workspaceSurfaceId.value
      });
      if (navigationTarget.sameOrigin) {
        await router.push(navigationTarget.href);
      } else if (typeof window === "object" && window?.location && typeof window.location.assign === "function") {
        window.location.assign(navigationTarget.href);
      } else {
        throw new Error("Cross-origin navigation is unavailable in this environment.");
      }
    } catch (error) {
      reportAccountFeedback({
        message: String(error?.message || "Unable to open workspace."),
        severity: "error",
        channel: "banner",
        dedupeKey: `users-web.account-settings-runtime:open-workspace:${String(workspaceSlug || "").trim()}`
      });
    }
  }

  async function respondToInvite(invite, decision) {
    if (!invitesAvailable.value) {
      return;
    }

    const token = String(invite?.token || "").trim();
    const normalizedDecision = String(decision || "").trim().toLowerCase();
    if (!token || (normalizedDecision !== "accept" && normalizedDecision !== "refuse")) {
      return;
    }
    if (isResolvingInvite.value) {
      return;
    }

    inviteAction.value = {
      token,
      decision: normalizedDecision
    };
    redeemInviteModel.token = token;
    redeemInviteModel.decision = normalizedDecision;

    try {
      await redeemInviteCommand.run();
      pendingInvitesModel.pendingInvites = pendingInvites.value.filter((entry) => entry.token !== token);
      await pendingInvitesView.refresh();

      if (normalizedDecision === "accept") {
        const nextWorkspaceSlug = String(invite?.workspaceSlug || "").trim();
        if (nextWorkspaceSlug) {
          await openWorkspace(nextWorkspaceSlug);
          return;
        }
      }

      reportAccountFeedback({
        message: normalizedDecision === "accept" ? "Invitation accepted." : "Invitation refused.",
        severity: "success",
        channel: "snackbar",
        dedupeKey: `users-web.account-settings-runtime:invite-${normalizedDecision}:${token}`
      });
    } catch (error) {
      const statusCode = resolveErrorStatusCode(error);
      const fallbackMessage = normalizedDecision === "accept"
        ? "Unable to accept invitation."
        : "Unable to refuse invitation.";
      reportAccountFeedback({
        message: statusCode === 404
          ? "Invitation no longer exists."
          : String(error?.message || fallbackMessage),
        severity: "error",
        channel: "banner",
        dedupeKey: `users-web.account-settings-runtime:invite-${normalizedDecision}-error:${token}`
      });
    } finally {
      inviteAction.value = {
        token: "",
        decision: ""
      };
      redeemInviteModel.token = "";
      redeemInviteModel.decision = "";
    }
  }

  function acceptInvite(invite) {
    return respondToInvite(invite, "accept");
  }

  function refuseInvite(invite) {
    return respondToInvite(invite, "refuse");
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

    if (avatarUppy) {
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
          dedupeKey: "users-web.account-settings-runtime:avatar-upload-invalid-response"
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
        dedupeKey: "users-web.account-settings-runtime:avatar-uploaded"
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
        dedupeKey: "users-web.account-settings-runtime:avatar-upload-error"
      });
    });

    uppy.on("restriction-failed", (_file, error) => {
      reportAccountFeedback({
        message: String(error?.message || "Selected avatar file does not meet upload restrictions."),
        severity: "error",
        channel: "banner",
        dedupeKey: "users-web.account-settings-runtime:avatar-upload-restriction"
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

    avatarUppy = uppy;
  }

  async function openAvatarEditor() {
    setupAvatarUploader();

    const uppy = avatarUppy;
    if (!uppy) {
      reportAccountFeedback({
        message: "Avatar editor is unavailable in this environment.",
        severity: "error",
        channel: "banner",
        dedupeKey: "users-web.account-settings-runtime:avatar-editor-unavailable"
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
    if (avatarUppy) {
      avatarUppy.destroy();
      avatarUppy = null;
    }
  });

  const profile = Object.freeze({
    form: profileForm,
    avatar: profileAvatar,
    initials: profileInitials,
    selectedAvatarFileName,
    fieldErrors: profileAddEdit.fieldErrors,
    isSaving: profileAddEdit.isSaving,
    isDeletingAvatar: avatarDeleteCommand.isRunning,
    submit: submitProfile,
    openAvatarEditor,
    removeAvatar: submitAvatarDelete
  });

  const preferences = Object.freeze({
    form: preferencesForm,
    fieldErrors: preferencesAddEdit.fieldErrors,
    isSaving: preferencesAddEdit.isSaving,
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
    submit: submitNotifications
  });

  const invites = Object.freeze({
    isAvailable: invitesAvailable,
    items: pendingInvites,
    isLoading: loadingInvites,
    isResolving: isResolvingInvite,
    action: inviteAction,
    accept: acceptInvite,
    refuse: refuseInvite
  });

  return Object.freeze({
    backTarget,
    backNavigationTarget,
    loadingSettings,
    profile,
    preferences,
    notifications,
    invites
  });
}

export { useAccountSettingsRuntime };
