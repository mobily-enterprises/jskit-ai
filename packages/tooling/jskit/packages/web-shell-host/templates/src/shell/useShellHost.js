import { computed, ref } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";

function createShellHostRuntime({
  listShellEntriesBySlot,
  resolveSurfaceFromPathname,
  evaluateShellGuard
} = {}) {
  if (typeof listShellEntriesBySlot !== "function") {
    throw new Error("createShellHostRuntime requires listShellEntriesBySlot.");
  }
  if (typeof resolveSurfaceFromPathname !== "function") {
    throw new Error("createShellHostRuntime requires resolveSurfaceFromPathname.");
  }
  if (typeof evaluateShellGuard !== "function") {
    throw new Error("createShellHostRuntime requires evaluateShellGuard.");
  }

  const drawerModel = ref(true);
  const navigate = useNavigate();

  const currentPath = useRouterState({
    select: (state) => state.location.pathname
  });

  const currentSurface = computed(() => resolveSurfaceFromPathname(currentPath.value));
  const shellEntries = computed(() => listShellEntriesBySlot(currentSurface.value));

  function filterEntriesByGuard(entries) {
    return (Array.isArray(entries) ? entries : []).filter((entry) => {
      const outcome = evaluateShellGuard({
        guard: entry?.guard,
        phase: "navigation",
        context: {
          pathname: currentPath.value,
          surface: currentSurface.value,
          slot: entry?.slot || ""
        }
      });

      return outcome.allow;
    });
  }

  const drawerEntries = computed(() => filterEntriesByGuard(shellEntries.value.drawer));
  const topEntries = computed(() => filterEntriesByGuard(shellEntries.value.top));
  const configEntries = computed(() => filterEntriesByGuard(shellEntries.value.config));

  const surfaceLabel = computed(() => {
    const surface = String(currentSurface.value || "app");
    return surface.charAt(0).toUpperCase() + surface.slice(1);
  });

  function isActive(pathname) {
    const current = String(currentPath.value || "");
    const target = String(pathname || "");
    if (!target || target === "/") {
      return current === "/";
    }
    return current === target || current.startsWith(`${target}/`);
  }

  const activeTitle = computed(() => {
    const candidate = [...drawerEntries.value, ...topEntries.value].find((entry) => isActive(entry.resolvedRoute));
    return candidate?.title || `${surfaceLabel.value} overview`;
  });

  function toggleDrawer() {
    drawerModel.value = !drawerModel.value;
  }

  function goToEntry(entry) {
    const target = String(entry?.resolvedRoute || "").trim();
    if (!target) {
      return;
    }
    navigate({ to: target });
  }

  return {
    drawerModel,
    currentSurface,
    surfaceLabel,
    drawerEntries,
    topEntries,
    configEntries,
    activeTitle,
    isActive,
    toggleDrawer,
    goToEntry
  };
}

export { createShellHostRuntime };
