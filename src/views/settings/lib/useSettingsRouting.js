import { computed, ref, watch } from "vue";
import { SETTINGS_SECTION_QUERY_KEY, VALID_SETTINGS_TABS } from "./useSettingsPageConfig";
import { resolveTabFromSearch } from "./useSettingsSharedHelpers";

export function useSettingsRouting({ navigate, routerPath, routerSearch, surfacePaths, workspaceStore }) {
  const activeTab = ref("profile");
  const syncingTabFromUrl = ref(false);

  function isSettingsRoutePath(pathname) {
    return surfacePaths.value.isAccountSettingsPath(pathname);
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
    if (!VALID_SETTINGS_TABS.has(nextTab) || activeTab.value === nextTab) {
      return;
    }

    activeTab.value = nextTab;
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

  async function goBack() {
    await navigate({
      to: backTarget.value
    });
  }

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
    if (!VALID_SETTINGS_TABS.has(nextTab)) {
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

  return {
    activeTab,
    selectSettingsSection,
    goBack
  };
}
