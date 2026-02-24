<template>
  <section class="console-error-detail-client-element" :class="rootClasses" :data-testid="uiTestIds.root">
    <v-card rounded="lg" elevation="1" border :class="uiClasses.card" :data-testid="uiTestIds.card">
      <v-card-title class="detail-title">
        <span class="text-subtitle-1 font-weight-bold">{{ copyText.title }}</span>
        <div class="detail-actions">
          <v-btn variant="outlined" :loading="state.loading" class="detail-action-btn" @click="onRefresh">
            {{ copyText.refresh }}
          </v-btn>
          <v-btn variant="text" class="detail-action-btn" @click="onGoBack">{{ copyText.back }}</v-btn>
        </div>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-alert v-if="!state.hasValidErrorId" type="error" variant="tonal" class="mb-3">
          {{ copyText.invalidIdMessage }}
        </v-alert>

        <v-alert v-if="state.error" type="error" variant="tonal" class="mb-3">
          {{ state.error }}
        </v-alert>

        <div v-if="state.loading" class="text-medium-emphasis py-8">{{ copyText.loadingMessage }}</div>

        <template v-else-if="state.entry">
          <dl class="detail-grid">
            <dt>ID</dt>
            <dd>#{{ state.entry.id }}</dd>

            <dt>{{ copyText.capturedLabel }}</dt>
            <dd>{{ formatDateTime(state.entry.createdAt) }}</dd>

            <template v-if="isBrowserMode">
              <dt>{{ copyText.occurredLabel }}</dt>
              <dd>{{ state.entry.occurredAt ? formatDateTime(state.entry.occurredAt) : copyText.unknown }}</dd>

              <dt>{{ copyText.surfaceLabel }}</dt>
              <dd>{{ state.entry.surface || copyText.unknown }}</dd>

              <dt>{{ copyText.sourceLabel }}</dt>
              <dd>{{ state.entry.source || copyText.browserDefaultSource }}</dd>
            </template>

            <template v-if="isServerMode">
              <dt>{{ copyText.statusLabel }}</dt>
              <dd>
                <v-chip size="small" label color="error" variant="tonal">{{ state.entry.statusCode }}</v-chip>
              </dd>

              <dt>{{ copyText.requestLabel }}</dt>
              <dd>{{ formatRequest(state.entry) }}</dd>

              <dt>{{ copyText.requestIdLabel }}</dt>
              <dd>{{ state.entry.requestId || copyText.unknown }}</dd>
            </template>

            <dt>{{ copyText.userLabel }}</dt>
            <dd>{{ state.entry.username || (state.entry.userId ? `#${state.entry.userId}` : copyText.anonymous) }}</dd>

            <template v-if="isBrowserMode">
              <dt>{{ copyText.locationLabel }}</dt>
              <dd>{{ formatLocation(state.entry) }}</dd>

              <dt>{{ copyText.urlLabel }}</dt>
              <dd>{{ state.entry.url || copyText.unknown }}</dd>
            </template>
          </dl>

          <h3 class="text-subtitle-2 mt-4 mb-2">{{ copyText.messageSection }}</h3>
          <pre class="detail-pre">{{ summarizeMessage(state.entry) }}</pre>

          <h3 class="text-subtitle-2 mt-4 mb-2">{{ copyText.stackSection }}</h3>
          <pre class="detail-pre">{{ state.entry.stack || copyText.noStack }}</pre>

          <h3 class="text-subtitle-2 mt-4 mb-2">{{ copyText.metadataSection }}</h3>
          <pre class="detail-pre">{{ formatJson(state.entry.metadata) }}</pre>
        </template>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { computed } from "vue";

const DEFAULT_COPY = Object.freeze({
  browserTitle: "Browser error details",
  serverTitle: "Server error details",
  refresh: "Refresh",
  browserBack: "Back to browser errors",
  serverBack: "Back to server errors",
  browserInvalidIdMessage: "Invalid browser error id.",
  serverInvalidIdMessage: "Invalid server error id.",
  browserLoadingMessage: "Loading browser error details...",
  serverLoadingMessage: "Loading server error details...",
  capturedLabel: "Captured",
  occurredLabel: "Occurred",
  surfaceLabel: "Surface",
  sourceLabel: "Source",
  statusLabel: "Status",
  requestLabel: "Request",
  requestIdLabel: "Request ID",
  userLabel: "User",
  locationLabel: "Location",
  urlLabel: "URL",
  messageSection: "Message",
  stackSection: "Stack",
  metadataSection: "Metadata",
  noStack: "No stack captured.",
  unknown: "unknown",
  browserDefaultSource: "window.error",
  anonymous: "anonymous"
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

const emit = defineEmits(["action:started", "action:succeeded", "action:failed", "interaction"]);

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
    back: isBrowserMode.value ? copy.browserBack || DEFAULT_COPY.browserBack : copy.serverBack || DEFAULT_COPY.serverBack,
    invalidIdMessage: isBrowserMode.value
      ? copy.browserInvalidIdMessage || DEFAULT_COPY.browserInvalidIdMessage
      : copy.serverInvalidIdMessage || DEFAULT_COPY.serverInvalidIdMessage,
    loadingMessage: isBrowserMode.value
      ? copy.browserLoadingMessage || DEFAULT_COPY.browserLoadingMessage
      : copy.serverLoadingMessage || DEFAULT_COPY.serverLoadingMessage,
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
    root: String(testIds.root || "console-error-detail-client-element"),
    card: String(testIds.card || "console-error-detail-card")
  };
});

const rootClasses = computed(() => [
  `console-error-detail-client-element--layout-${resolvedVariant.value.layout}`,
  `console-error-detail-client-element--surface-${resolvedVariant.value.surface}`,
  `console-error-detail-client-element--density-${resolvedVariant.value.density}`,
  `console-error-detail-client-element--tone-${resolvedVariant.value.tone}`
]);

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

function formatJson(value) {
  if (typeof meta.formatJson === "function") {
    return meta.formatJson(value);
  }
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

async function onRefresh() {
  emitInteraction("refresh");
  await invokeAction("refresh", {}, () => actions.refresh());
}

async function onGoBack() {
  emitInteraction("go-back");
  await invokeAction("goBack", {}, () => actions.goBack());
}
</script>

<style scoped>
.detail-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.detail-grid {
  display: grid;
  grid-template-columns: minmax(120px, 160px) 1fr;
  gap: 8px 16px;
}

.detail-grid dt {
  font-weight: 600;
  color: rgba(0, 0, 0, 0.72);
}

.detail-grid dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.detail-pre {
  margin: 0;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid rgba(54, 66, 58, 0.18);
  background-color: rgba(15, 107, 84, 0.05);
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.82rem;
  line-height: 1.35;
}

@media (max-width: 700px) {
  .detail-actions {
    width: 100%;
    display: grid;
    gap: 8px;
  }

  .detail-action-btn {
    width: 100%;
  }

  .detail-grid {
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .detail-grid dt {
    margin-top: 10px;
  }
}
</style>
