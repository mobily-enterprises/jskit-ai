import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useLayout } from "vuetify";
import { useShellWebErrorRuntime } from "../error/inject.js";
import { resolveBannerPlacement } from "../error/presentation.js";
import { useShellErrorPresentationStore } from "../stores/useShellErrorPresentationStore.js";
import { useJskitText } from "../i18n.js";
import { useShellWindowSizeClass } from "./useShellWindowSizeClass.js";

const BANNER_INLINE_HEIGHT_PROPERTY = "--shell-error-banners-inline-height";
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
 * What the error host shows and does: the snackbar queue, the dialog, and where the banners sit. Inline banners publish
 * their height so full-viewport surfaces can start below them.
 */
function useShellErrorHost() {
  const runtime = useShellWebErrorRuntime();
  const { t } = useJskitText();
  const store = useShellErrorPresentationStore();

  const snackbarEntries = computed(() => store.channels.snackbar || []);
  const bannerEntries = computed(() => store.channels.banner || []);
  const dialogEntry = computed(() => store.channels.dialog[0] || null);
  const displayedSnackbarEntry = ref(null);
  const layoutRect = useLayout().mainRect;

  const bannersElement = ref(null);
  const bannerPlacement = computed(() => resolveBannerPlacement(layoutRect.value));
  let bannerResizeObserver = null;

  function stopObservingBanners() {
    bannerResizeObserver?.disconnect();
    bannerResizeObserver = null;
    publishInlineBannerHeight(0);
  }

  watch(
    [bannersElement, () => bannerPlacement.value.inline],
    ([element, inline]) => {
      stopObservingBanners();
      if (!element || !inline) {
        return;
      }
      bannerResizeObserver = new ResizeObserver(() => {
        publishInlineBannerHeight(element.getBoundingClientRect().height);
      });
      bannerResizeObserver.observe(element);
      publishInlineBannerHeight(element.getBoundingClientRect().height);
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
