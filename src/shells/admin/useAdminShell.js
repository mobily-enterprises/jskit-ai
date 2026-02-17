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

function workspaceInitials(workspace) {
  const source = String(workspace?.name || workspace?.slug || "W").trim();
  return source.slice(0, 2).toUpperCase();
}

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

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString();
}

export function useAdminShell() {
  const authStore = useAuthStore();
  const workspaceStore = useWorkspaceStore();
  const navigate = useNavigate();
  const display = useDisplay();
  const currentPath = useRouterState({
    select: (state) => state.location.pathname
  });
  const surfacePaths = computed(() => resolveSurfacePaths(currentPath.value));
  const appSurfacePaths = createSurfacePaths("app");

  const menuNoticeVisible = ref(false);
  const menuNoticeMessage = ref("");
  const mobileDrawerOpen = ref(false);
  const desktopDrawerOpen = ref(true);
  const inviteDialogVisible = ref(false);
  const inviteDialogInvite = ref(null);
  const inviteDecisionBusy = ref(false);

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
  const workspacePath = (suffix = "/") => workspaceStore.workspacePath(suffix);

  const appSurfaceTargetPath = computed(() => {
    const activeWorkspaceSlug = String(workspaceStore.activeWorkspaceSlug || "").trim();
    if (activeWorkspaceSlug) {
      return appSurfacePaths.workspaceHomePath(activeWorkspaceSlug);
    }

    return appSurfacePaths.workspacesPath;
  });

  const navigationItems = computed(() => [
    { title: "Choice 1", to: workspacePath("/"), icon: "$navChoice1" },
    { title: "Choice 2", to: workspacePath("/choice-2"), icon: "$navChoice2" },
    { title: "Workspace", to: workspacePath("/settings"), icon: "$menuSettings" },
    { title: "Back to App", to: appSurfaceTargetPath.value, icon: "$menuProfile", forceReload: true }
  ]);

  const destinationTitle = computed(() => {
    if (currentPath.value.endsWith("/choice-2")) {
      return "Choice 2";
    }
    if (currentPath.value.endsWith("/settings")) {
      return "Settings";
    }
    return "Calculator";
  });

  const workspaceItems = computed(() => (Array.isArray(workspaceStore.workspaces) ? workspaceStore.workspaces : []));
  const pendingInvites = computed(() => (Array.isArray(workspaceStore.pendingInvites) ? workspaceStore.pendingInvites : []));
  const pendingInvitesCount = computed(() => pendingInvites.value.length);

  const activeWorkspaceName = computed(() => {
    if (workspaceStore.activeWorkspace?.name) {
      return String(workspaceStore.activeWorkspace.name);
    }

    return pendingInvitesCount.value > 0 ? "Workspace invites" : "Workspace";
  });

  const activeWorkspaceAvatarUrl = computed(() => {
    return workspaceStore.activeWorkspace?.avatarUrl ? String(workspaceStore.activeWorkspace.avatarUrl) : "";
  });

  const activeWorkspaceInitials = computed(() => {
    const source = String(workspaceStore.activeWorkspace?.name || workspaceStore.activeWorkspace?.slug || "W").trim();
    return source.slice(0, 2).toUpperCase();
  });
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

  watch(
    () => pendingInvitesCount.value,
    (nextCount, previousCount) => {
      if (!showApplicationShell.value) {
        return;
      }

      if (nextCount > 0 && nextCount > (previousCount || 0)) {
        menuNoticeMessage.value = `You have ${nextCount} pending workspace invite${nextCount === 1 ? "" : "s"}.`;
        menuNoticeVisible.value = true;
      }
    }
  );

  function workspaceAvatarStyle(workspace) {
    return {
      backgroundColor: normalizeWorkspaceColor(workspace?.color)
    };
  }

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

  function handleMenuNotice(label) {
    menuNoticeMessage.value = `${label} is not implemented yet in this scaffold.`;
    menuNoticeVisible.value = true;
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

  async function goToSettingsTab(section) {
    await goToAccountTab(section);
  }

  async function goToAppSurface() {
    await hardNavigate(appSurfaceTargetPath.value);
  }

  async function selectWorkspaceFromShell(workspaceSlug) {
    const slug = String(workspaceSlug || "").trim();
    if (!slug) {
      return;
    }

    if (slug === workspaceStore.activeWorkspaceSlug) {
      return;
    }

    try {
      await workspaceStore.selectWorkspace(slug);
      await navigate({
        to: surfacePaths.value.workspaceHomePath(slug)
      });
    } catch (error) {
      menuNoticeMessage.value = String(error?.message || "Unable to switch workspace.");
      menuNoticeVisible.value = true;
    }
  }

  function openInviteDialog(invite) {
    inviteDialogInvite.value = invite;
    inviteDialogVisible.value = true;
  }

  async function respondToInvite(decision) {
    const invite = inviteDialogInvite.value;
    if (!invite?.id) {
      return;
    }

    inviteDecisionBusy.value = true;
    try {
      const result = await workspaceStore.respondToPendingInvite(invite.id, decision);

      if (result?.decision === "accepted" && result?.workspace?.slug) {
        await navigate({
          to: surfacePaths.value.workspaceHomePath(result.workspace.slug)
        });
        menuNoticeMessage.value = `Joined ${result.workspace.name || result.workspace.slug}.`;
        menuNoticeVisible.value = true;
      }

      if (result?.decision === "refused") {
        menuNoticeMessage.value = "Invitation refused.";
        menuNoticeVisible.value = true;
      }

      inviteDialogVisible.value = false;
      inviteDialogInvite.value = null;
    } catch (error) {
      menuNoticeMessage.value = String(error?.message || "Unable to process invitation.");
      menuNoticeVisible.value = true;
    } finally {
      inviteDecisionBusy.value = false;
    }
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
    meta: {
      workspaceInitials,
      formatDateTime
    },
    state: {
      workspaceStore,
      showApplicationShell,
      isDesktopPermanentDrawer,
      isDesktopCollapsible,
      isMobile,
      activeWorkspaceAvatarUrl,
      activeWorkspaceInitials,
      activeWorkspaceName,
      pendingInvitesCount,
      workspaceItems,
      pendingInvites,
      destinationTitle,
      activeWorkspaceColor,
      userAvatarUrl,
      userInitials,
      drawerModel,
      navigationItems,
      inviteDialogVisible,
      inviteDialogInvite,
      inviteDecisionBusy,
      menuNoticeVisible,
      menuNoticeMessage,
      workspaceThemeStyle
    },
    actions: {
      toggleDrawer,
      workspaceAvatarStyle,
      selectWorkspaceFromShell,
      openInviteDialog,
      goToAccountTab,
      goToAppSurface,
      handleMenuNotice,
      signOut,
      isCurrentPath,
      goToNavigationItem,
      respondToInvite,
      goTo,
      goToSettingsTab
    }
  };
}
