import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import {
  resolveShellDrawerPresentation,
  resolveShellDrawerToggleLabel
} from "../support/drawerPresentation.js";
import {
  DEFAULT_SHELL_DRAWER_WIDTH,
  measureDrawerContentWidth,
  normalizeShellDrawerWidth,
  normalizeShellNavigationItemSpacing,
  normalizeShellRailWidth,
  resolveMaterialDrawerWidth
} from "../support/drawerWidth.js";

// VNavigationDrawer has no root element of its own to reach through a template ref.
function navigationDrawerElement() {
  return document.getElementById("jskit-shell-drawer");
}

/**
 * The shell's navigation drawer: what opens it on each layout, how it presents, and how wide it is. The drawer is
 * modal on compact and medium windows and a standard drawer, collapsing to a rail, on expanded ones. It fits its labels
 * and identity, within Material 3's 360dp and leaving a modal drawer's 56dp of the page, unless `drawerWidth` is
 * "material" (Material 3's full width) or a number, which fixes it.
 * @param {object} options
 * @param {{ desktopDrawerClosedMode: string, drawerWidth: number | string | null, railWidth: number, navigationItemSpacing: number }} options.props
 * @param {import("vue").Ref<boolean>} options.modalLayout
 * @param {import("vue").Ref<number>} options.viewportWidth
 * @param {import("vue").Ref<{ $el: HTMLElement } | null>} options.navigationToggle
 * @param {ReturnType<typeof import("./useShellLayoutState.js").useShellLayoutState>} options.layoutState
 */
function useShellDrawer({ props, modalLayout, viewportWidth, navigationToggle, layoutState }) {
  const {
    drawerDefaultOpen,
    drawerOpen,
    resolvedSurface,
    setDrawerOpen
  } = layoutState;
  const wideDrawerOpen = ref(Boolean(drawerDefaultOpen.value));
  const measuredDrawerWidth = ref(DEFAULT_SHELL_DRAWER_WIDTH);
  let drawerContentObserver = null;
  let drawerMeasurementFrame = null;
  let shellMounted = false;

  const drawerPresentation = computed(() => resolveShellDrawerPresentation({
    modal: modalLayout.value,
    open: drawerOpen.value,
    desktopClosedMode: props.desktopDrawerClosedMode
  }));
  const drawerToggleLabel = computed(() => resolveShellDrawerToggleLabel({
    modal: modalLayout.value,
    open: drawerOpen.value
  }));
  const fixedDrawerWidth = computed(() => !["content", null, undefined].includes(props.drawerWidth));
  const resolvedDrawerWidth = computed(() => {
    const materialWidth = resolveMaterialDrawerWidth({ modal: modalLayout.value, viewportWidth: viewportWidth.value });
    if (!fixedDrawerWidth.value) {
      return Math.min(normalizeShellDrawerWidth(measuredDrawerWidth.value), materialWidth);
    }
    if (props.drawerWidth === "material") {
      return materialWidth;
    }
    return normalizeShellDrawerWidth(props.drawerWidth);
  });
  const resolvedRailWidth = computed(() => normalizeShellRailWidth(props.railWidth));
  const resolvedNavigationItemSpacing = computed(() =>
    normalizeShellNavigationItemSpacing(props.navigationItemSpacing)
  );
  watch(
    drawerOpen,
    handleDrawerOpenChange
  );

  watch(
    modalLayout,
    handleLayoutClassChange,
    { immediate: true }
  );

  watch(drawerPresentation, scheduleDrawerWidthMeasurement, { flush: "post" });
  watch(resolvedSurface, scheduleDrawerWidthMeasurement, { flush: "post" });
  watch(resolvedNavigationItemSpacing, scheduleDrawerWidthMeasurement, { flush: "post" });

  onMounted(attachShellListeners);
  onBeforeUnmount(detachShellListeners);

  function attachShellListeners() {
    shellMounted = true;
    window.addEventListener("keydown", handleShellKeydown);
    window.addEventListener("resize", scheduleDrawerWidthMeasurement, { passive: true });

    void document.fonts.ready.then(scheduleDrawerWidthMeasurement);
    document.fonts.addEventListener("loadingdone", scheduleDrawerWidthMeasurement);
    void nextTick().then(initializeDrawerMeasurement);
  }

  function detachShellListeners() {
    shellMounted = false;
    window.removeEventListener("keydown", handleShellKeydown);
    window.removeEventListener("resize", scheduleDrawerWidthMeasurement);
    document.fonts.removeEventListener("loadingdone", scheduleDrawerWidthMeasurement);
    drawerContentObserver?.disconnect();
    drawerContentObserver = null;
    if (drawerMeasurementFrame !== null) {
      window.cancelAnimationFrame(drawerMeasurementFrame);
      drawerMeasurementFrame = null;
    }
  }

  function handleDrawerOpenChange(open) {
    if (!modalLayout.value) {
      wideDrawerOpen.value = Boolean(open);
    }
  }

  function handleLayoutClassChange(modal) {
    setDrawerOpen(modal ? false : wideDrawerOpen.value);
  }

  function handleShellKeydown(event) {
    if (
      event.defaultPrevented ||
      event.key !== "Escape" ||
      !modalLayout.value ||
      !drawerOpen.value
    ) {
      return;
    }

    event.preventDefault();
    setDrawerOpen(false);
    void nextTick().then(focusNavigationToggle);
  }

  function focusNavigationToggle() {
    navigationToggle.value?.$el?.focus({ preventScroll: true });
  }

  function initializeDrawerMeasurement() {
    const drawerElement = navigationDrawerElement();
    if (drawerElement) {
      drawerContentObserver?.disconnect();
      drawerContentObserver = new MutationObserver(scheduleDrawerWidthMeasurement);
      drawerContentObserver.observe(drawerElement.querySelector(".v-navigation-drawer__content") || drawerElement, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }
    scheduleDrawerWidthMeasurement();
  }

  function scheduleDrawerWidthMeasurement() {
    if (
      !shellMounted ||
      fixedDrawerWidth.value ||
      !drawerPresentation.value.visible ||
      drawerPresentation.value.rail
    ) {
      return;
    }

    if (drawerMeasurementFrame !== null) {
      window.cancelAnimationFrame(drawerMeasurementFrame);
    }
    drawerMeasurementFrame = window.requestAnimationFrame(updateMeasuredDrawerWidth);
  }

  function updateMeasuredDrawerWidth() {
    drawerMeasurementFrame = null;
    const drawerElement = navigationDrawerElement();
    if (!drawerElement) {
      return;
    }

    const nextWidth = measureDrawerContentWidth(drawerElement, resolvedNavigationItemSpacing.value);
    if (Math.abs(nextWidth - measuredDrawerWidth.value) >= 0.25) {
      measuredDrawerWidth.value = nextWidth;
    }
  }

  function handleDrawerVisibilityChange(open) {
    if (modalLayout.value || drawerPresentation.value.closedMode === "hidden" || open === false) {
      setDrawerOpen(open);
    }
  }

  return {
    drawerPresentation,
    drawerToggleLabel,
    fixedDrawerWidth,
    handleDrawerVisibilityChange,
    resolvedDrawerWidth,
    resolvedNavigationItemSpacing,
    resolvedRailWidth
  };
}

export { useShellDrawer };
