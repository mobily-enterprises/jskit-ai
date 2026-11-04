<script setup>
import { useShellErrorHost } from "../composables/useShellErrorHost.js";
import {
  actionsFor,
  resolveSeverityColor,
  resolveSeverityIcon,
  resolveTimeout
} from "../error/presentation.js";
import { useJskitText } from "../i18n.js";

// Entries keep the server's code and params, so an API error shows in the
// user's language; anything else shows as reported.
const { t, text, serverMessage } = useJskitText();
const {
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
  snackbarOpen
} = useShellErrorHost();
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
          :close-label="t('jskit.shell.actions.close')"
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
