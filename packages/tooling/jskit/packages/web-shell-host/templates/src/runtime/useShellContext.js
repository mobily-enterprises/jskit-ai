import { computed } from "vue";

function resolveShellContext() {
  if (typeof globalThis !== "object" || !globalThis) {
    return {};
  }
  return globalThis.__JSKIT_WEB_SHELL_CONTEXT__ || {};
}

function useShellContext({ goToEntry } = {}) {
  const shellContext = resolveShellContext();

  const workspaceThemeStyle = computed(() => ({
    "--workspace-color": String(shellContext?.workspace?.color || "#0f6b54"),
    "--workspace-color-soft": String(shellContext?.workspace?.softColor || "rgba(15, 107, 84, 0.12)"),
    "--workspace-color-strong": String(shellContext?.workspace?.strongColor || "rgba(15, 107, 84, 0.18)")
  }));

  const workspaceItems = computed(() => {
    const workspaces = Array.isArray(shellContext?.workspaces) ? shellContext.workspaces : [];
    if (workspaces.length > 0) {
      return workspaces;
    }
    return [
      {
        id: "workspace-demo",
        name: String(shellContext?.workspace?.name || "JSKIT Demo"),
        slug: String(shellContext?.workspace?.slug || "demo")
      }
    ];
  });

  const activeWorkspace = computed(() => {
    return (
      workspaceItems.value.find((workspace) => workspace.slug === shellContext?.workspace?.slug) ||
      workspaceItems.value[0]
    );
  });

  const alertsPreviewEntries = computed(() => {
    const alerts = shellContext?.alerts?.items;
    return Array.isArray(alerts) ? alerts : [];
  });

  const unreadAlertsCount = computed(() => {
    const raw = shellContext?.alerts?.unreadCount;
    return Number.isFinite(raw) ? Number(raw) : alertsPreviewEntries.value.length;
  });

  const realtimeStatusLabel = computed(() => {
    return String(shellContext?.realtime?.label || "Live");
  });

  const realtimeStatusColor = computed(() => {
    return String(shellContext?.realtime?.color || "success");
  });

  const userDisplayName = computed(() => {
    return String(shellContext?.user?.name || shellContext?.user?.displayName || "User");
  });

  const userInitials = computed(() => {
    const name = userDisplayName.value.trim();
    if (!name) {
      return "U";
    }
    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("");
  });

  function selectWorkspace(workspace) {
    if (typeof shellContext?.onWorkspaceSelect === "function") {
      shellContext.onWorkspaceSelect(workspace);
    }
  }

  function openAlert(alert) {
    if (typeof shellContext?.onAlertSelect === "function") {
      shellContext.onAlertSelect(alert);
      return;
    }
    if (alert?.route && typeof goToEntry === "function") {
      goToEntry({ resolvedRoute: alert.route });
    }
  }

  return {
    shellContext,
    workspaceThemeStyle,
    workspaceItems,
    activeWorkspace,
    alertsPreviewEntries,
    unreadAlertsCount,
    realtimeStatusLabel,
    realtimeStatusColor,
    userDisplayName,
    userInitials,
    selectWorkspace,
    openAlert
  };
}

export { useShellContext };
