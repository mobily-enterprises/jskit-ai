import { computed, ref, watch } from "vue";

const DESKTOP_DRAWER_BEHAVIOR = (() => {
  const rawMode = String(import.meta.env.VITE_DESKTOP_DRAWER_BEHAVIOR || "collapsible").toLowerCase();
  return rawMode === "permanent" ? "permanent" : "collapsible";
})();

export function useShellNavigation({ currentPath, navigate, showApplicationShell, display }) {
  const mobileDrawerOpen = ref(false);
  const desktopDrawerOpen = ref(true);

  const isMobile = computed(() => display.smAndDown.value);
  const isDesktopPermanentDrawer = computed(() => DESKTOP_DRAWER_BEHAVIOR === "permanent");
  const isDesktopCollapsible = computed(() => !isMobile.value && !isDesktopPermanentDrawer.value);

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

  return {
    state: {
      isMobile,
      isDesktopPermanentDrawer,
      isDesktopCollapsible,
      drawerModel
    },
    actions: {
      toggleDrawer,
      isCurrentPath,
      goTo,
      hardNavigate,
      goToNavigationItem
    }
  };
}
