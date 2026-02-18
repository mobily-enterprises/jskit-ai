import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { useTheme } from "vuetify";
import { resolveSurfacePaths } from "../../../shared/routing/surfacePaths.js";
import { api } from "../../services/api/index.js";
import { useAuthStore } from "../../stores/authStore.js";
import { useWorkspaceStore } from "../../stores/workspaceStore.js";
import { useAuthGuard } from "../../composables/useAuthGuard.js";
import { SETTINGS_QUERY_KEY, settingsSections } from "./lib/useSettingsPageConfig.js";
import { clearFieldErrors, resolveTabFromSearch, toErrorMessage } from "./lib/useSettingsSharedHelpers.js";
import { useSettingsRouting } from "./lib/useSettingsRouting.js";
import { useSettingsProfileForm } from "./profile/useSettingsProfileForm.js";
import { useSettingsPreferencesForm } from "./preferences/useSettingsPreferencesForm.js";
import { useSettingsSecurityForm } from "./security/useSettingsSecurityForm.js";
import { useSettingsNotificationsForm } from "./notifications/useSettingsNotificationsForm.js";

export function useSettingsView() {
  const navigate = useNavigate();
  const authStore = useAuthStore();
  const workspaceStore = useWorkspaceStore();
  const queryClient = useQueryClient();
  const vuetifyTheme = useTheme();
  const { handleUnauthorizedError } = useAuthGuard();

  const settingsEnabled = ref(false);
  const loadError = ref("");

  const routerSearch = useRouterState({
    select: (state) => state.location.search
  });
  const routerPath = useRouterState({
    select: (state) => state.location.pathname
  });
  const surfacePaths = computed(() => resolveSurfacePaths(routerPath.value));

  const { activeTab, selectSettingsSection, goBack } = useSettingsRouting({
    navigate,
    routerPath,
    routerSearch,
    surfacePaths,
    workspaceStore
  });

  const settingsQuery = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => api.settings.get(),
    enabled: settingsEnabled
  });

  const handleAuthError = async (error) => handleUnauthorizedError(error);

  let applySettingsData = () => {};
  const applySettingsDataRef = (data) => {
    applySettingsData(data);
  };

  const preferences = useSettingsPreferencesForm({
    vuetifyTheme,
    queryClient,
    clearFieldErrors,
    toErrorMessage,
    handleAuthError,
    applySettingsData: applySettingsDataRef
  });

  const profile = useSettingsProfileForm({
    preferencesForm: preferences.state.preferencesForm,
    queryClient,
    authStore,
    workspaceStore,
    clearFieldErrors,
    toErrorMessage,
    handleAuthError,
    applySettingsData: applySettingsDataRef
  });

  const security = useSettingsSecurityForm({
    settingsQuery
  });

  const notifications = useSettingsNotificationsForm({
    queryClient,
    toErrorMessage,
    handleAuthError,
    applySettingsData: applySettingsDataRef
  });

  applySettingsData = (data) => {
    profile.hydrate(data);
    preferences.hydrate(data);
    security.hydrate(data);
    notifications.hydrate(data);
  };

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

  onMounted(async () => {
    profile.initialize();
    await security.initialize();
    settingsEnabled.value = true;
  });

  onBeforeUnmount(() => {
    profile.dispose();
  });

  return {
    page: {
      meta: {
        settingsSections
      },
      state: reactive({
        activeTab,
        loadError
      }),
      actions: {
        selectSettingsSection,
        goBack,
        resolveTabFromSearch,
        toErrorMessage,
        handleAuthError
      }
    },
    sections: {
      profile,
      preferences,
      security,
      notifications
    }
  };
}
