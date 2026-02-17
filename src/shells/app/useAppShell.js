import { computed, ref, watch } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { useDisplay } from "vuetify";
import { createSurfacePaths, resolveSurfacePaths } from "../../../shared/routing/surfacePaths.js";
import { api } from "../../services/api";
import { useAuthStore } from "../../stores/authStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";

const DESKTOP_DRAWER_BEHAVIOR = (() => {
  const rawMode = String(import.meta.env.VITE_DESKTOP_DRAWER_BEHAVIOR || "collapsible").toLowerCase();
  return rawMode === "permanent" ? "permanent" : "collapsible";
})();

const DEFAULT_WORKSPACE_COLOR = "#0F6B54";
const WORKSPACE_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

function normalizeWorkspaceColor(value) {
  const normalized = String(value || "").trim();
  if (WORKSPACE_COLOR_PATTERN.test(normalized)) {
    return normalized.toUpperCase();
  }

  return DEFAULT_WORKSPACE_COLOR;
}

function workspaceColorToRgb(color) {
  const normalized = normalizeWorkspaceColor(color).replace(/^#/, "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return [red, green, blue];
}

export function useAppShell() {
  const authStore = useAuthStore();
  const workspaceStore = useWorkspaceStore();
  const navigate = useNavigate();
  const display = useDisplay();
  const currentPath = useRouterState({
    select: (state) => state.location.pathname
  });
  const surfacePaths = computed(() => resolveSurfacePaths(currentPath.value));
  const adminSurfacePaths = createSurfacePaths("admin");

  const mobileDrawerOpen = ref(false);
  const desktopDrawerOpen = ref(true);

  const isMobile = computed(() => display.smAndDown.value);
  const isDesktopPermanentDrawer = computed(() => DESKTOP_DRAWER_BEHAVIOR === "permanent");
  const isDesktopCollapsible = computed(() => !isMobile.value && !isDesktopPermanentDrawer.value);
  const showApplicationShell = computed(() => {
    const paths = surfacePaths.value;
    return !(
      currentPath.value === paths.loginPath ||
      currentPath.value === paths.resetPasswordPath ||
      currentPath.value === paths.workspacesPath ||
      currentPath.value === paths.accountSettingsPath
    );
  });

  function workspacePath(pathname = "/") {
    return surfacePaths.value.workspacePath(workspaceStore.activeWorkspaceSlug, pathname);
  }

  const memberWorkspaces = computed(() => (Array.isArray(workspaceStore.workspaces) ? workspaceStore.workspaces : []));
  const activeWorkspaceHasMembership = computed(
    () => Boolean(workspaceStore.activeWorkspaceSlug) && Boolean(workspaceStore.membership?.roleId)
  );
  const canViewWorkspaceAdminSettings = computed(
    () => workspaceStore.can("workspace.settings.view") || workspaceStore.can("workspace.settings.update")
  );
  const canOpenAdminSurface = computed(() => activeWorkspaceHasMembership.value && canViewWorkspaceAdminSettings.value);
  const activeWorkspaceColor = computed(() => normalizeWorkspaceColor(workspaceStore.activeWorkspace?.color));
  const workspaceThemeStyle = computed(() => {
    const [red, green, blue] = workspaceColorToRgb(activeWorkspaceColor.value);
    return {
      "--v-theme-primary": `${red}, ${green}, ${blue}`,
      "--workspace-color": activeWorkspaceColor.value,
      "--workspace-color-soft": `rgba(${red}, ${green}, ${blue}, 0.12)`,
      "--workspace-color-strong": `rgba(${red}, ${green}, ${blue}, 0.24)`
    };
  });
  const adminSurfaceTargetPath = computed(() => {
    const activeWorkspaceSlug = String(workspaceStore.activeWorkspaceSlug || "").trim();

    if (activeWorkspaceSlug && canOpenAdminSurface.value) {
      return adminSurfacePaths.workspacePath(activeWorkspaceSlug, "/settings");
    }

    if (memberWorkspaces.value.length > 0) {
      return adminSurfacePaths.workspacesPath;
    }

    return adminSurfacePaths.loginPath;
  });

  const navigationItems = computed(() => {
    const items = [
      { title: "Choice 1", to: workspacePath("/"), icon: "$navChoice1" },
      { title: "Choice 2", to: workspacePath("/choice-2"), icon: "$navChoice2" }
    ];

    if (canOpenAdminSurface.value) {
      items.push({
        title: "Go to Admin",
        to: adminSurfaceTargetPath.value,
        icon: "$menuSettings",
        forceReload: true
      });
    }

    return items;
  });

  const destinationTitle = computed(() => {
    if (currentPath.value.endsWith("/choice-2")) {
      return "Choice 2";
    }
    return "Customer";
  });

  const drawerModel = computed({
    get() {
      if (!showApplicationShell.value) {
        return false;
      }
      if (isMobile.value) {
        return mobileDrawerOpen.value;
      }
      if (isDesktopPermanentDrawer.value) {
        return true;
      }
      return desktopDrawerOpen.value;
    },
    set(nextValue) {
      if (!showApplicationShell.value) {
        mobileDrawerOpen.value = false;
        desktopDrawerOpen.value = false;
        return;
      }
      if (isMobile.value) {
        mobileDrawerOpen.value = Boolean(nextValue);
        return;
      }
      if (!isDesktopPermanentDrawer.value) {
        desktopDrawerOpen.value = Boolean(nextValue);
      }
    }
  });

  const userInitials = computed(() => {
    const source = String(workspaceStore.profileDisplayName || authStore.username || "A").trim();
    return source.slice(0, 2).toUpperCase();
  });

  const userAvatarUrl = computed(() => workspaceStore.profileAvatarUrl || "");

  watch([showApplicationShell, isMobile, isDesktopPermanentDrawer], ([isShellVisible, mobile, permanentDesktop]) => {
    if (!isShellVisible || mobile) {
      mobileDrawerOpen.value = false;
    }
    if (permanentDesktop) {
      desktopDrawerOpen.value = true;
    }
    if (!isShellVisible) {
      desktopDrawerOpen.value = false;
    }
  });

  watch(
    [showApplicationShell, isMobile],
    ([isShellVisible, mobile], [wasShellVisible]) => {
      if (!isShellVisible || mobile) {
        mobileDrawerOpen.value = false;
      }
      if (isShellVisible && !mobile && !wasShellVisible && !isDesktopPermanentDrawer.value) {
        desktopDrawerOpen.value = true;
      }
    },
    { immediate: true }
  );

  function toggleDrawer() {
    if (!showApplicationShell.value) {
      return;
    }

    if (isMobile.value) {
      drawerModel.value = !drawerModel.value;
      return;
    }

    if (isDesktopPermanentDrawer.value) {
      return;
    }

    desktopDrawerOpen.value = !desktopDrawerOpen.value;
  }

  function isCurrentPath(path) {
    return currentPath.value === path;
  }

  async function goTo(path) {
    const targetPath = String(path || "").trim();
    if (!targetPath) {
      return;
    }

    if (currentPath.value === targetPath) {
      if (isMobile.value) {
        drawerModel.value = false;
      }
      return;
    }

    await navigate({ to: targetPath });
    if (isMobile.value) {
      drawerModel.value = false;
    }
  }

  async function hardNavigate(path) {
    const targetPath = String(path || "").trim();
    if (!targetPath) {
      return;
    }

    if (typeof window !== "undefined") {
      window.location.assign(targetPath);
      return;
    }

    await navigate({ to: targetPath });
  }

  async function goToNavigationItem(item) {
    if (item?.forceReload) {
      await hardNavigate(item.to);
      return;
    }

    await goTo(item?.to);
  }

  async function goToAccountTab(tab) {
    const paths = surfacePaths.value;
    await navigate({
      to: paths.accountSettingsPath,
      search: {
        section: tab,
        returnTo: currentPath.value
      }
    });
  }

  async function goToAdminSurface() {
    if (!canOpenAdminSurface.value) {
      return;
    }

    await hardNavigate(adminSurfaceTargetPath.value);
  }

  async function signOut() {
    const paths = surfacePaths.value;
    try {
      await api.logout();
    } finally {
      api.clearCsrfTokenCache();
      authStore.setSignedOut();
      workspaceStore.clearWorkspaceState();
      await authStore.invalidateSession();
      await navigate({ to: paths.loginPath, replace: true });
    }
  }

  return {
    meta: {},
    state: {
      workspaceThemeStyle,
      showApplicationShell,
      isDesktopPermanentDrawer,
      isMobile,
      isDesktopCollapsible,
      activeWorkspaceColor,
      destinationTitle,
      userAvatarUrl,
      userInitials,
      canOpenAdminSurface,
      drawerModel,
      navigationItems
    },
    actions: {
      toggleDrawer,
      goToAccountTab,
      goToAdminSurface,
      signOut,
      isCurrentPath,
      goToNavigationItem
    }
  };
}
