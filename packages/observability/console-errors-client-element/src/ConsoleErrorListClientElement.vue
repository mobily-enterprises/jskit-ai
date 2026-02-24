<template>
  <section class="console-error-list-client-element" :class="rootClasses" :data-testid="uiTestIds.root">
    <v-card rounded="lg" elevation="1" border :class="uiClasses.card" :data-testid="uiTestIds.card">
      <v-card-title class="d-grid ga-3">
        <div class="d-flex align-center">
          <span class="text-subtitle-1 font-weight-bold">{{ copyText.title }}</span>
        </div>
        <div class="actions-row d-flex flex-wrap align-center justify-end ga-3">
          <v-select
            :model-value="state.pageSize"
            :items="meta.pageSizeOptions"
            :label="copyText.rowsLabel"
            density="compact"
            variant="outlined"
            hide-details
            class="rows-select"
            @update:model-value="onPageSizeChange"
          />
          <v-btn
            color="error"
            variant="tonal"
            :loading="simulateBusy"
            class="header-btn text-none"
            @click="onSimulate"
          >
            {{ copyText.simulateAction }}<span class="simulation-label"> ({{ meta.nextSimulationLabel }})</span>
          </v-btn>
          <v-btn variant="outlined" :loading="state.loading" class="header-btn text-none" @click="onRefresh">
            {{ copyText.refresh }}
          </v-btn>
        </div>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-alert v-if="state.simulationMessage" :type="state.simulationMessageType" variant="tonal" class="mb-3">
          {{ state.simulationMessage }}
        </v-alert>
        <v-alert v-if="state.error" type="error" variant="tonal" class="mb-3">
          {{ state.error }}
        </v-alert>

        <div class="errors-table-wrap">
          <v-table density="comfortable">
            <thead>
              <tr>
                <th>{{ copyText.capturedColumn }}</th>
                <th v-if="isBrowserMode">{{ copyText.surfaceColumn }}</th>
                <th v-if="isBrowserMode">{{ copyText.sourceColumn }}</th>
                <th v-if="isServerMode">{{ copyText.statusColumn }}</th>
                <th v-if="isServerMode">{{ copyText.requestColumn }}</th>
                <th>{{ copyText.messageColumn }}</th>
                <th v-if="isBrowserMode">{{ copyText.locationColumn }}</th>
                <th>{{ copyText.userColumn }}</th>
                <th>{{ copyText.actionsColumn }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!state.entries.length" class="empty-row">
                <td :colspan="tableColumnCount" class="empty-cell text-center text-medium-emphasis py-6">{{ copyText.empty }}</td>
              </tr>
              <tr v-for="entry in state.entries" :key="entry.id">
                <td :data-label="copyText.capturedColumn">{{ formatDateTime(entry.createdAt) }}</td>
                <td v-if="isBrowserMode" :data-label="copyText.surfaceColumn">
                  <v-chip size="small" label>{{ entry.surface || copyText.unknown }}</v-chip>
                </td>
                <td v-if="isBrowserMode" :data-label="copyText.sourceColumn">{{ entry.source || copyText.browserDefaultSource }}</td>
                <td v-if="isServerMode" :data-label="copyText.statusColumn">
                  <v-chip size="small" label color="error" variant="tonal">{{ entry.statusCode }}</v-chip>
                </td>
                <td v-if="isServerMode" :data-label="copyText.requestColumn">{{ formatRequest(entry) }}</td>
                <td :data-label="copyText.messageColumn" class="error-message-cell">{{ summarizeMessage(entry) }}</td>
                <td v-if="isBrowserMode" :data-label="copyText.locationColumn">{{ formatLocation(entry) }}</td>
                <td :data-label="copyText.userColumn">{{ entry.username || (entry.userId ? `#${entry.userId}` : copyText.anonymous) }}</td>
                <td :data-label="copyText.actionsColumn" class="actions-cell">
                  <v-btn size="small" variant="text" @click="onViewEntry(entry)">{{ copyText.view }}</v-btn>
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>

        <div class="pagination-row d-flex align-center justify-space-between ga-3 flex-wrap mt-4">
          <p class="text-body-2 text-medium-emphasis mb-2">
            {{ copyText.pagePrefix }} {{ state.page }} {{ copyText.pageMiddle }} {{ state.totalPages }} ({{ state.total }} {{ copyText.pageSuffix }})
          </p>
          <div class="pagination-actions d-flex ga-2">
            <v-btn variant="outlined" :disabled="state.page <= 1 || state.loading" @click="onPrevious">
              {{ copyText.previous }}
            </v-btn>
            <v-btn variant="outlined" :disabled="state.page >= state.totalPages || state.loading" @click="onNext">
              {{ copyText.next }}
            </v-btn>
          </div>
        </div>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { computed } from "vue";

const DEFAULT_COPY = Object.freeze({
  browserTitle: "Browser errors",
  serverTitle: "Server errors",
  rowsLabel: "Rows",
  simulateBrowserAction: "Simulate client error",
  simulateServerAction: "Simulate server error",
  refresh: "Refresh",
  capturedColumn: "Captured",
  surfaceColumn: "Surface",
  sourceColumn: "Source",
  statusColumn: "Status",
  requestColumn: "Request",
  messageColumn: "Message",
  locationColumn: "Location",
  userColumn: "User",
  actionsColumn: "Actions",
  unknown: "unknown",
  browserDefaultSource: "window.error",
  anonymous: "anonymous",
  view: "View",
  emptyBrowser: "No browser errors captured.",
  emptyServer: "No server errors captured.",
  pagePrefix: "Page",
  pageMiddle: "of",
  pageSuffix: "total",
  previous: "Previous",
  next: "Next"
});

const props = defineProps({
  mode: {
    type: String,
    default: "browser"
  },
  meta: {
    type: Object,
    required: true
  },
  state: {
    type: Object,
    required: true
  },
  actions: {
    type: Object,
    required: true
  },
  copy: {
    type: Object,
    default: () => ({})
  },
  variant: {
    type: Object,
    default: () => ({})
  },
  ui: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits([
  "action:started",
  "action:succeeded",
  "action:failed",
  "interaction",
  "simulate:trigger",
  "error:view"
]);

function toRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function normalizeVariantValue(value, supported, fallback) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!supported.includes(normalized)) {
    return fallback;
  }
  return normalized;
}

const meta = props.meta;
const state = props.state;
const actions = props.actions;

const resolvedMode = computed(() => {
  const mode = String(props.mode || "").trim().toLowerCase();
  if (mode === "server") {
    return "server";
  }
  return "browser";
});

const isBrowserMode = computed(() => resolvedMode.value === "browser");
const isServerMode = computed(() => resolvedMode.value === "server");

const copyText = computed(() => {
  const copy = toRecord(props.copy);
  return {
    ...DEFAULT_COPY,
    title: isBrowserMode.value ? copy.browserTitle || DEFAULT_COPY.browserTitle : copy.serverTitle || DEFAULT_COPY.serverTitle,
    simulateAction: isBrowserMode.value
      ? copy.simulateBrowserAction || DEFAULT_COPY.simulateBrowserAction
      : copy.simulateServerAction || DEFAULT_COPY.simulateServerAction,
    empty: isBrowserMode.value ? copy.emptyBrowser || DEFAULT_COPY.emptyBrowser : copy.emptyServer || DEFAULT_COPY.emptyServer,
    ...copy
  };
});

const resolvedVariant = computed(() => {
  const variant = toRecord(props.variant);
  return {
    layout: normalizeVariantValue(variant.layout, ["compact", "comfortable"], "comfortable"),
    surface: normalizeVariantValue(variant.surface, ["plain", "carded"], "carded"),
    density: normalizeVariantValue(variant.density, ["compact", "comfortable"], "comfortable"),
    tone: normalizeVariantValue(variant.tone, ["neutral", "emphasized"], "neutral")
  };
});

const uiClasses = computed(() => {
  const classes = toRecord(toRecord(props.ui).classes);
  return {
    card: String(classes.card || "").trim()
  };
});

const uiTestIds = computed(() => {
  const testIds = toRecord(toRecord(props.ui).testIds);
  return {
    root: String(testIds.root || "console-error-list-client-element"),
    card: String(testIds.card || "console-error-list-card")
  };
});

const rootClasses = computed(() => [
  `console-error-list-client-element--layout-${resolvedVariant.value.layout}`,
  `console-error-list-client-element--surface-${resolvedVariant.value.surface}`,
  `console-error-list-client-element--density-${resolvedVariant.value.density}`,
  `console-error-list-client-element--tone-${resolvedVariant.value.tone}`
]);

const tableColumnCount = computed(() => (isBrowserMode.value ? 7 : 6));
const simulateBusy = computed(() => (isServerMode.value ? Boolean(state.simulateErrorBusy) : false));

function emitInteraction(type, payload = {}) {
  emit("interaction", {
    type,
    mode: resolvedMode.value,
    ...payload
  });
}

async function invokeAction(actionName, payload, callback) {
  emit("action:started", {
    action: actionName,
    payload
  });
  try {
    if (typeof callback === "function") {
      await callback();
    }
    emit("action:succeeded", {
      action: actionName,
      payload
    });
  } catch (errorValue) {
    emit("action:failed", {
      action: actionName,
      payload,
      message: String(errorValue?.message || "Action failed")
    });
    throw errorValue;
  }
}

function formatDateTime(value) {
  if (typeof meta.formatDateTime === "function") {
    return meta.formatDateTime(value);
  }
  return String(value || "unknown");
}

function formatRequest(entry) {
  if (typeof meta.formatRequest === "function") {
    return meta.formatRequest(entry);
  }
  return "-";
}

function formatLocation(entry) {
  if (typeof meta.formatLocation === "function") {
    return meta.formatLocation(entry);
  }
  return "-";
}

function summarizeMessage(entry) {
  if (isBrowserMode.value && typeof meta.summarizeBrowserMessage === "function") {
    return meta.summarizeBrowserMessage(entry);
  }
  if (isServerMode.value && typeof meta.summarizeServerMessage === "function") {
    return meta.summarizeServerMessage(entry);
  }
  return String(entry?.message || "");
}

async function onPageSizeChange(value) {
  await invokeAction("onPageSizeChange", { value: Number(value || 0) }, () => actions.onPageSizeChange(value));
}

async function onRefresh() {
  emitInteraction("refresh");
  await invokeAction("load", {}, () => actions.load());
}

async function onSimulate() {
  emit("simulate:trigger", {
    mode: resolvedMode.value
  });
  emitInteraction("simulate:trigger");

  if (isBrowserMode.value && typeof actions.simulateClientError === "function") {
    await invokeAction("simulateClientError", {}, () => actions.simulateClientError());
    return;
  }

  if (isServerMode.value && typeof actions.simulateServerError === "function") {
    await invokeAction("simulateServerError", {}, () => actions.simulateServerError());
  }
}

async function onViewEntry(entry) {
  const payload = {
    id: Number(entry?.id || 0)
  };
  emit("error:view", payload);
  emitInteraction("error:view", payload);
  await invokeAction("viewEntry", payload, () => actions.viewEntry(entry));
}

async function onPrevious() {
  await invokeAction("goPrevious", {}, () => actions.goPrevious());
}

async function onNext() {
  await invokeAction("goNext", {}, () => actions.goNext());
}
</script>

<style scoped>
.rows-select {
  flex: 0 0 120px;
  max-width: 120px;
}

.header-btn {
  white-space: normal;
}

.errors-table-wrap {
  overflow-x: auto;
  border: 1px solid rgba(54, 66, 58, 0.14);
  border-radius: 12px;
  background-color: #fff;
}

.error-message-cell {
  max-width: 480px;
  white-space: normal;
  word-break: break-word;
}

.simulation-label {
  display: inline;
}

@media (max-width: 700px) {
  .actions-row {
    justify-content: stretch;
  }

  .rows-select {
    flex: 1 1 100%;
    max-width: none;
  }

  .header-btn {
    flex: 1 1 100%;
  }

  .simulation-label {
    display: none;
  }

  .errors-table-wrap {
    border: 0;
    background: transparent;
    overflow: visible;
  }

  .errors-table-wrap :deep(thead) {
    display: none;
  }

  .errors-table-wrap :deep(tbody tr) {
    display: block;
    border: 1px solid rgba(54, 66, 58, 0.14);
    border-radius: 12px;
    background: #fff;
    padding: 8px 0;
    margin-bottom: 10px;
  }

  .errors-table-wrap :deep(tbody tr.empty-row) {
    padding: 0;
    margin-bottom: 0;
  }

  .errors-table-wrap :deep(tbody td) {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 12px;
    white-space: normal;
  }

  .errors-table-wrap :deep(tbody td::before) {
    content: attr(data-label);
    flex: 0 0 78px;
    font-weight: 600;
    color: rgba(0, 0, 0, 0.7);
  }

  .errors-table-wrap :deep(tbody td.actions-cell) {
    justify-content: flex-end;
  }

  .errors-table-wrap :deep(tbody td.actions-cell::before) {
    display: none;
  }

  .empty-cell {
    display: block;
  }

  .empty-cell::before {
    display: none;
  }

  .pagination-row {
    display: grid;
    gap: 8px;
  }

  .pagination-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
}
</style>
