<script setup>
import { computed } from "vue";
import {
  useShellWebErrorRuntime
} from "../error/inject.js";
import { useShellErrorPresentationStore } from "../stores/useShellErrorPresentationStore.js";

const runtime = useShellWebErrorRuntime();
const store = useShellErrorPresentationStore();

const snackbarEntry = computed(() => store.channels.snackbar[0] || null);
const bannerEntries = computed(() => store.channels.banner || []);
const dialogEntry = computed(() => store.channels.dialog[0] || null);

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

function runAction(entry) {
  if (!entry || !entry.action || typeof entry.action.handler !== "function") {
    return;
  }

  try {
    entry.action.handler(entry);
  } catch (error) {
    runtime.report({
      source: "shell-web.error-host.action",
      message: "Error action failed.",
      cause: error,
      severity: "error",
      channel: "dialog"
    });
  }

  if (entry.action.dismissOnRun !== false) {
    dismiss(entry);
  }
}

function onSnackbarModelValue(nextValue) {
  if (nextValue === false && snackbarEntry.value) {
    dismiss(snackbarEntry.value);
  }
}

function onDialogModelValue(nextValue) {
  if (nextValue === false && dialogEntry.value && dialogEntry.value.persist !== true) {
    dismiss(dialogEntry.value);
  }
}
</script>

<template>
  <div class="shell-error-host" aria-live="polite">
    <div v-if="bannerEntries.length > 0" class="shell-error-host__banners">
      <div class="shell-error-host__banner-stack">
        <v-alert
          v-for="entry in bannerEntries"
          :key="entry.id"
          :type="resolveSeverityColor(entry.severity)"
          variant="elevated"
          density="comfortable"
          rounded="lg"
          border="start"
          class="shell-error-host__banner"
          closable
          @click:close="dismiss(entry)"
        >
          <div class="d-flex align-center ga-3 flex-wrap">
            <span>{{ entry.message }}</span>
            <v-spacer />
            <v-btn
              v-if="entry.action"
              variant="text"
              size="small"
              class="text-none"
              @click="runAction(entry)"
            >
              {{ entry.action.label }}
            </v-btn>
          </div>
        </v-alert>
      </div>
    </div>

    <v-snackbar
      :model-value="Boolean(snackbarEntry)"
      location="bottom end"
      :timeout="resolveTimeout(snackbarEntry)"
      :color="resolveSeverityColor(snackbarEntry?.severity)"
      @update:model-value="onSnackbarModelValue"
    >
      <span v-if="snackbarEntry">{{ snackbarEntry.message }}</span>

      <template #actions>
        <v-btn
          v-if="snackbarEntry?.action"
          variant="text"
          size="small"
          @click="runAction(snackbarEntry)"
        >
          {{ snackbarEntry.action.label }}
        </v-btn>
        <v-btn
          v-if="snackbarEntry"
          variant="text"
          size="small"
          @click="dismiss(snackbarEntry)"
        >
          Dismiss
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
        <v-card-title class="text-subtitle-1">Attention required</v-card-title>
        <v-card-text>{{ dialogEntry.message }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            v-if="dialogEntry.action"
            variant="text"
            @click="runAction(dialogEntry)"
          >
            {{ dialogEntry.action.label }}
          </v-btn>
          <v-btn
            color="primary"
            variant="tonal"
            @click="dismiss(dialogEntry)"
          >
            Close
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.shell-error-host__banners {
  position: fixed;
  top: calc(env(safe-area-inset-top, 0px) + var(--shell-error-banner-offset, 64px));
  left: 0;
  right: 0;
  z-index: 2600;
  pointer-events: none;
  padding: 10px 12px;
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

@media (max-width: 600px) {
  .shell-error-host__banners {
    top: calc(env(safe-area-inset-top, 0px) + var(--shell-error-banner-offset-mobile, 56px));
    padding: 8px;
  }
}
</style>
