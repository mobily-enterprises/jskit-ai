import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useLayout } from "vuetify";
import { useShellWebErrorRuntime } from "../error/inject.js";
import { resolveBannerPlacement } from "../error/presentation.js";
import { useShellErrorPresentationStore } from "../stores/useShellErrorPresentationStore.js";
import { useJskitText } from "../i18n.js";
import { useShellWindowSizeClass } from "./useShellWindowSizeClass.js";

const BANNER_INLINE_HEIGHT_PROPERTY = "--shell-error-banners-inline-height";
// The name of the top layout item floating banners take below the app bar, and its order: after every default-order
// item (the app bar, the navigation rail or drawer), so the banners sit under the app bar and beside the navigation,
// over the content's own width, whatever order the app mounts them in.
const BANNER_LAYOUT_ITEM_NAME = "shell-error-host-banners";
const BANNER_LAYOUT_ITEM_ORDER = 1;
// Above Vuetify's overlays (2400), as the banners always were.
const BANNER_Z_INDEX = 2600;
// The modal surfaces that keep their actions at their bottom edge on a compact window, where the snackbar shows: an
// open dialog (a bottom sheet is one) and an open temporary navigation drawer.
const MODAL_SURFACE_SELECTOR = [
  ".v-dialog.v-overlay--active",
  ".v-navigation-drawer--temporary.v-navigation-drawer--active"
].join(", ");

function isModalSurfaceOpen() {
  return document.querySelector(MODAL_SURFACE_SELECTOR) !== null;
}

function isSameSnackbarEntry(left = null, right = null) {
  return Boolean(left?.id && right?.id && left.id === right.id);
}

function publishInlineBannerHeight(height = 0) {
  const rootStyle = document.documentElement.style;
  if (height > 0) {
    rootStyle.setProperty(BANNER_INLINE_HEIGHT_PROPERTY, `${Math.ceil(height)}px`);
  } else {
    rootStyle.removeProperty(BANNER_INLINE_HEIGHT_PROPERTY);
  }
}

/**
 * What the error host shows and does: the snackbar queue, the dialog, and where the banners sit. Below a top app bar the
 * banners take a top layout item of their own measured height, so the page's content starts below them; without one
 * they join the page flow and publish their height so full-viewport surfaces can start below them.
 */
function useShellErrorHost() {
  const runtime = useShellWebErrorRuntime();
  const { t } = useJskitText();
  const store = useShellErrorPresentationStore();

  const snackbarEntries = computed(() => store.channels.snackbar || []);
  const bannerEntries = computed(() => store.channels.banner || []);
  const dialogEntry = computed(() => store.channels.dialog[0] || null);
  const displayedSnackbarEntry = ref(null);
  const layout = useLayout();

  const bannersElement = ref(null);
  // The floating banners' measured height: the room their layout item takes below the app bar.
  const bannerHeight = ref(0);
  // Where the banners start: under the top app bar, which mainRect's top is. Once they float, the layout counts their
  // own room in mainRect too, so their layout item says where they start.
  const bannerTop = computed(() => {
    const item = layout.getLayoutItem(BANNER_LAYOUT_ITEM_NAME);
    return item ? item.top : layout.mainRect.value.top;
  });
  const bannerPlacement = computed(() => resolveBannerPlacement(bannerTop.value));
  // The floating banners' VLayoutItem.
  const bannerLayoutItemProps = computed(() => ({
    name: BANNER_LAYOUT_ITEM_NAME,
    order: BANNER_LAYOUT_ITEM_ORDER,
    position: "top",
    size: bannerHeight.value,
    modelValue: true,
    style: { zIndex: BANNER_Z_INDEX }
  }));
  let bannerResizeObserver = null;

  function stopObservingBanners() {
    bannerResizeObserver?.disconnect();
    bannerResizeObserver = null;
    publishInlineBannerHeight(0);
    bannerHeight.value = 0;
  }

  watch(
    [bannersElement, () => bannerPlacement.value.inline],
    ([element, inline]) => {
      stopObservingBanners();
      if (!element) {
        return;
      }
      const measure = () => {
        const height = element.getBoundingClientRect().height;
        if (inline) {
          publishInlineBannerHeight(height);
        } else {
          bannerHeight.value = Math.ceil(height);
        }
      };
      bannerResizeObserver = new ResizeObserver(measure);
      bannerResizeObserver.observe(element);
      measure();
    },
    { flush: "post" }
  );

  onBeforeUnmount(stopObservingBanners);
  const snackbarOpen = ref(false);
  // Material 3 keeps a snackbar clear of the actions it reports on. A message that shows while a modal surface is
  // open sits at the top of a compact window, clear of the surface's actions, and keeps that place until it leaves.
  const { isCompact } = useShellWindowSizeClass();
  const snackbarOverModalSurface = ref(false);
  const snackbarLocation = computed(() => (isCompact.value && snackbarOverModalSurface.value ? "top" : "bottom start"));

  function hasSnackbarEntry(entry = null) {
    if (!entry?.id) {
      return false;
    }

    return snackbarEntries.value.some((candidate) => isSameSnackbarEntry(candidate, entry));
  }

  function openNextSnackbarEntry() {
    const nextEntry = snackbarEntries.value[0] || null;
    if (!nextEntry) {
      displayedSnackbarEntry.value = null;
      snackbarOpen.value = false;
      return;
    }

    snackbarOverModalSurface.value = isModalSurfaceOpen();
    displayedSnackbarEntry.value = nextEntry;
    snackbarOpen.value = true;
  }

  watch(
    snackbarEntries,
    (entries) => {
      const currentEntry = displayedSnackbarEntry.value;
      if (!currentEntry) {
        openNextSnackbarEntry();
        return;
      }

      const matchingEntry = entries.find((entry) => isSameSnackbarEntry(entry, currentEntry)) || null;
      if (matchingEntry) {
        displayedSnackbarEntry.value = matchingEntry;
        return;
      }

      snackbarOpen.value = false;
    },
    {
      immediate: true,
      // After the page has rendered, so a dialog that closed with the change that reported the message (a saved
      // form) no longer counts as open.
      flush: "post"
    }
  );

  function dismiss(entry) {
    if (!entry || !entry.channel || !entry.id) {
      return;
    }

    store.dismiss(entry.channel, entry.id);
  }

  async function runAction(entry, action) {
    try {
      await action.handler(entry);
    } catch (error) {
      runtime.report({
        source: "shell-web.error-host.action",
        message: t("jskit.shell.error.actionFailed"),
        cause: error,
        intent: "blocking",
        severity: "error"
      });
    }

    if (action.dismissOnRun !== false) {
      dismiss(entry);
    }
  }

  function onSnackbarModelValue(nextValue) {
    if (nextValue === false && displayedSnackbarEntry.value) {
      snackbarOpen.value = false;
      dismiss(displayedSnackbarEntry.value);
    }
  }

  function onDialogModelValue(nextValue) {
    if (nextValue === false && dialogEntry.value && dialogEntry.value.persist !== true) {
      dismiss(dialogEntry.value);
    }
  }

  function onSnackbarAfterLeave() {
    if (hasSnackbarEntry(displayedSnackbarEntry.value)) {
      return;
    }

    openNextSnackbarEntry();
  }

  return {
    bannerEntries,
    bannerLayoutItemProps,
    bannerPlacement,
    bannersElement,
    dialogEntry,
    dismiss,
    displayedSnackbarEntry,
    onDialogModelValue,
    onSnackbarAfterLeave,
    onSnackbarModelValue,
    runAction,
    snackbarLocation,
    snackbarOpen
  };
}

export { useShellErrorHost };
