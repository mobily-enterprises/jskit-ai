<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useLayout } from "vuetify";
import { mdiAlertOutline, mdiCheckCircleOutline, mdiInformationOutline } from "@mdi/js";
import {
  useShellWebErrorRuntime
} from "../error/inject.js";
import { useShellErrorPresentationStore } from "../stores/useShellErrorPresentationStore.js";
import { useJskitText } from "../i18n.js";

const runtime = useShellWebErrorRuntime();
// Entries keep the server's code and params, so an API error shows in the
// user's language; anything else shows as reported.
const { t, text, serverMessage } = useJskitText();
const store = useShellErrorPresentationStore();

const snackbarEntries = computed(() => store.channels.snackbar || []);
const bannerEntries = computed(() => store.channels.banner || []);
const dialogEntry = computed(() => store.channels.dialog[0] || null);
const displayedSnackbarEntry = ref(null);
const layoutRect = readLayoutRect();

function readLayoutRect() {
  try {
    return useLayout().mainRect;
  } catch {
    return null;
  }
}

// Banners float just below a top app bar. A surface without one (sign-in pages)
// has nothing to float under, so the banners join the page flow above the
// content instead of covering it, and publish their height so full-viewport
// surfaces can start below them.
const BANNER_INLINE_HEIGHT_PROPERTY = "--shell-error-banners-inline-height";
const bannersElement = ref(null);
const bannerPlacement = computed(() => {
  const rect = layoutRect?.value || {};
  const top = Number(rect.top) || 0;
  if (top <= 0) {
    return { inline: true, style: undefined };
  }

  return {
    inline: false,
    style: {
      top: `calc(env(safe-area-inset-top, 0px) + ${top}px)`,
      left: `${Number(rect.left) || 0}px`,
      right: `${Number(rect.right) || 0}px`
    }
  };
});
let bannerResizeObserver = null;

function publishInlineBannerHeight(height = 0) {
  const rootStyle = globalThis.document?.documentElement?.style;
  if (!rootStyle) {
    return;
  }
  if (height > 0) {
    rootStyle.setProperty(BANNER_INLINE_HEIGHT_PROPERTY, `${Math.ceil(height)}px`);
  } else {
    rootStyle.removeProperty(BANNER_INLINE_HEIGHT_PROPERTY);
  }
}

function stopObservingBanners() {
  bannerResizeObserver?.disconnect();
  bannerResizeObserver = null;
  publishInlineBannerHeight(0);
}

watch(
  [bannersElement, () => bannerPlacement.value.inline],
  ([element, inline]) => {
    stopObservingBanners();
    if (!element || !inline || typeof globalThis.ResizeObserver !== "function") {
      return;
    }
    bannerResizeObserver = new globalThis.ResizeObserver(() => {
      publishInlineBannerHeight(element.getBoundingClientRect().height);
    });
    bannerResizeObserver.observe(element);
    publishInlineBannerHeight(element.getBoundingClientRect().height);
  },
  { flush: "post" }
);

onBeforeUnmount(stopObservingBanners);
const snackbarOpen = ref(false);

function isSameSnackbarEntry(left = null, right = null) {
  return Boolean(left?.id && right?.id && left.id === right.id);
}

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
    immediate: true
  }
);

function resolveSeverityColor(severity = "error") {
  const normalized = String(severity || "error").trim().toLowerCase();
  if (normalized === "info") {
    return "info";
  }
  if (normalized === "success") {
    return "success";
  }
  if (normalized === "warning") {
    return "warning";
  }
  return "error";
}

function resolveSeverityIcon(severity = "error") {
  const normalized = String(severity || "error").trim().toLowerCase();
  if (normalized === "info") {
    return mdiInformationOutline;
  }
  if (normalized === "success") {
    return mdiCheckCircleOutline;
  }
  return mdiAlertOutline;
}

function resolveTimeout(entry) {
  if (!entry) {
    return -1;
  }
  if (entry.persist) {
    return -1;
  }
  return 5000;
}

function dismiss(entry) {
  if (!entry || !entry.channel || !entry.id) {
    return;
  }

  store.dismiss(entry.channel, entry.id);
}

function actionsFor(entry) {
  return entry ? [entry.action, ...entry.additionalActions].filter(Boolean) : [];
}

async function runAction(entry, action) {
  if (!entry || typeof action?.handler !== "function") {
    return;
  }

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
</script>

<template>
  <div
    class="shell-error-host"
    :class="{ 'shell-error-host--inline-banners': bannerPlacement.inline }"
    aria-live="polite"
  >
    <div
      v-if="bannerEntries.length > 0"
      ref="bannersElement"
      class="shell-error-host__banners"
      :class="{ 'shell-error-host__banners--inline': bannerPlacement.inline }"
      :style="bannerPlacement.style"
      data-testid="shell-error-host-banners"
    >
      <div class="shell-error-host__banner-stack">
        <v-alert
          v-for="entry in bannerEntries"
          :key="entry.id"
          :type="resolveSeverityColor(entry.severity)"
          :icon="resolveSeverityIcon(entry.severity)"
          variant="elevated"
          density="comfortable"
          rounded="lg"
          border="start"
          class="shell-error-host__banner"
          closable
          @click:close="dismiss(entry)"
        >
          <div class="d-flex align-center ga-3 flex-wrap">
            <span>{{ serverMessage(entry) }}</span>
            <v-spacer />
            <v-btn
              v-for="(action, index) in actionsFor(entry)"
              :key="index"
              variant="text"
              size="small"
              class="text-none"
              @click="runAction(entry, action)"
            >
              {{ text(action.label) }}
            </v-btn>
          </div>
        </v-alert>
      </div>
    </div>

    <v-snackbar
      :model-value="snackbarOpen"
      location="bottom end"
      :timeout="resolveTimeout(displayedSnackbarEntry)"
      :vertical="actionsFor(displayedSnackbarEntry).length > 1"
      :color="displayedSnackbarEntry ? resolveSeverityColor(displayedSnackbarEntry.severity) : undefined"
      @update:model-value="onSnackbarModelValue"
      @after-leave="onSnackbarAfterLeave"
    >
      <span v-if="displayedSnackbarEntry">{{ serverMessage(displayedSnackbarEntry) }}</span>

      <template #actions>
        <v-btn
          v-for="(action, index) in actionsFor(displayedSnackbarEntry)"
          :key="index"
          variant="text"
          min-height="48"
          @click="runAction(displayedSnackbarEntry, action)"
        >
          {{ text(action.label) }}
        </v-btn>
        <v-btn
          v-if="displayedSnackbarEntry"
          variant="text"
          size="small"
          @click="dismiss(displayedSnackbarEntry)"
        >
          {{ t("jskit.shell.actions.dismiss") }}
        </v-btn>
      </template>
    </v-snackbar>

    <v-dialog
      :model-value="Boolean(dialogEntry)"
      max-width="560"
      :persistent="Boolean(dialogEntry?.persist)"
      @update:model-value="onDialogModelValue"
    >
      <v-card v-if="dialogEntry">
        <v-card-title class="text-subtitle-1">{{ t("jskit.shell.error.attentionRequired") }}</v-card-title>
        <v-card-text>{{ serverMessage(dialogEntry) }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            v-for="(action, index) in actionsFor(dialogEntry)"
            :key="index"
            variant="text"
            @click="runAction(dialogEntry, action)"
          >
            {{ text(action.label) }}
          </v-btn>
          <v-btn
            color="primary"
            variant="tonal"
            @click="dismiss(dialogEntry)"
          >
            {{ t("jskit.shell.actions.close") }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.shell-error-host--inline-banners {
  order: -1;
}

.shell-error-host__banners {
  position: fixed;
  z-index: 2600;
  pointer-events: none;
  padding: 10px 12px;
}

.shell-error-host__banners--inline {
  position: relative;
  z-index: auto;
  padding-top: calc(env(safe-area-inset-top, 0px) + 10px);
}

.shell-error-host__banner-stack {
  margin: 0 auto;
  width: min(1120px, 100%);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.shell-error-host__banner {
  pointer-events: auto;
  box-shadow: var(--v-shadow-4);
}

/*
 * The close button always uses the banner's own on-color (the message colour) on
 * a tonal disc of that colour, so a themed button default can never turn it into
 * a low-contrast red-on-red mark, in light or dark themes.
 */
.shell-error-host__banner :deep(.v-alert__close .v-btn) {
  color: inherit !important;
  opacity: 1;
  background-color: color-mix(in srgb, currentColor 18%, transparent);
}

.shell-error-host__banner :deep(.v-alert__close .v-btn .v-icon) {
  font-size: 20px;
}

@media (max-width: 600px) {
  .shell-error-host__banners {
    padding: 8px;
  }

  .shell-error-host__banners--inline {
    padding-top: calc(env(safe-area-inset-top, 0px) + 8px);
  }
}
</style>
