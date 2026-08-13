import { computed, inject, ref, unref } from "vue";
import { JSKIT_NAVIGATION_RUNTIME_KEY } from "@jskit-ai/kernel/client/navigation";

function useShellLeadingNavigation({
  menuAvailable = false,
  openMenu = null,
  backLabel = "Back",
  menuLabel = "Open navigation menu"
} = {}) {
  const navigation = inject(JSKIT_NAVIGATION_RUNTIME_KEY, null);
  if (!navigation) {
    throw new Error(
      "Shell leading navigation requires JSKIT navigation. Pass createShellRouter({ navigation: true }) and bootstrap the returned runtime."
    );
  }

  const busy = ref(false);
  const mode = computed(() => {
    if (navigation.state.canGoUp) {
      return "back";
    }
    return Boolean(unref(menuAvailable)) ? "menu" : "none";
  });
  const label = computed(() => mode.value === "back"
    ? String(unref(backLabel) || "Back")
    : String(unref(menuLabel) || "Open navigation menu"));
  const predictiveProgress = computed(() => navigation.state.predictiveProgress);

  async function goUp() {
    if (busy.value) {
      return;
    }
    busy.value = true;
    try {
      return await navigation.goUp({ reason: "shell-back" });
    } finally {
      busy.value = false;
    }
  }

  async function activate() {
    if (mode.value === "back") {
      return goUp();
    }
    if (mode.value === "menu" && typeof openMenu === "function") {
      return openMenu();
    }
  }

  return Object.freeze({
    mode,
    canGoUp: computed(() => navigation.state.canGoUp),
    busy,
    label,
    predictiveProgress,
    activate,
    goUp,
    openMenu
  });
}

export { useShellLeadingNavigation };
