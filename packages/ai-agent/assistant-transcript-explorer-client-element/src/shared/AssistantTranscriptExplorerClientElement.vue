<template>
  <section class="assistant-transcript-explorer-client-element" :class="rootClasses" :data-testid="uiTestIds.root">
    <v-row>
      <v-col v-if="resolvedFeatures.listPanel" cols="12" lg="5">
        <v-card rounded="lg" elevation="1" border :class="uiClasses.listCard" :data-testid="uiTestIds.listCard">
          <v-card-item>
            <v-card-title class="text-subtitle-1 font-weight-bold">{{ copyText.listTitle }}</v-card-title>
            <v-card-subtitle>{{ copyText.listSubtitle }}</v-card-subtitle>
          </v-card-item>
          <v-divider />
          <v-card-text>
            <v-alert v-if="state.error" type="error" variant="tonal" class="mb-3">
              {{ state.error }}
            </v-alert>

            <div class="d-flex flex-wrap ga-3 align-center mb-3">
              <v-text-field
                v-if="isConsoleMode"
                v-model="state.workspaceIdFilter"
                :label="copyText.workspaceIdLabel"
                density="compact"
                variant="outlined"
                hide-details
                class="filters-field"
              />

              <v-select
                v-if="resolvedFeatures.statusFilter"
                :model-value="state.statusFilter"
                :items="meta.statusOptions"
                item-title="title"
                item-value="value"
                :label="copyText.statusLabel"
                density="compact"
                variant="outlined"
                hide-details
                class="filters-field"
                @update:model-value="onStatusFilterChange"
              />

              <v-select
                :model-value="state.pageSize"
                :items="meta.pageSizeOptions"
                :label="copyText.rowsLabel"
                density="compact"
                variant="outlined"
                hide-details
                class="filters-field"
                @update:model-value="onPageSizeChange"
              />

              <v-select
                v-if="isWorkspaceMode && resolvedFeatures.memberFilter"
                :model-value="state.memberUserFilter"
                :items="state.memberFilterOptions"
                item-title="title"
                item-value="value"
                :label="copyText.userLabel"
                density="compact"
                variant="outlined"
                hide-details
                class="filters-field"
                @update:model-value="onMemberFilterChange"
              />

              <v-btn
                v-if="isWorkspaceMode"
                variant="outlined"
                :loading="state.loading"
                @click="onRefresh"
              >
                {{ copyText.refresh }}
              </v-btn>

              <v-btn
                v-if="isConsoleMode"
                color="primary"
                :loading="state.loading"
                @click="onApplyFilters"
              >
                {{ copyText.apply }}
              </v-btn>
            </div>

            <slot name="filters-extra" :meta="meta" :state="state" :actions="actions" :mode="resolvedMode" />

            <template v-if="state.loading && state.entries.length < 1">
              <v-skeleton-loader type="list-item-two-line@4" />
            </template>
            <v-list v-else density="comfortable" class="pa-0 transcript-list" :class="uiClasses.transcriptList">
              <v-list-item v-if="!state.entries.length" :title="copyText.emptyList" />
              <v-list-item
                v-for="entry in state.entries"
                v-else
                :key="entry.id"
                :active="state.selectedConversation?.id === entry.id"
                @click="onSelectConversation(entry)"
              >
                <template #title>
                  <div class="d-flex align-center ga-2">
                    <span>#{{ entry.id }}</span>
                    <v-chip size="x-small" label>{{ entry.status }}</v-chip>
                  </div>
                </template>
                <template #subtitle>
                  <div class="text-caption text-medium-emphasis">
                    <template v-if="isWorkspaceMode">
                      {{ formatConversationActor(entry) }} • {{ formatDateTime(entry.startedAt) }} •
                      {{ formatTranscriptMode(entry.transcriptMode) }} • {{ entry.messageCount }} {{ copyText.messagesLabel }}
                    </template>
                    <template v-else>
                      {{ copyText.workspacePrefix }} {{ entry.workspaceId }} ({{ entry.workspaceSlug || copyText.unknown }}) •
                      {{ formatDateTime(entry.startedAt) }}
                    </template>
                  </div>
                </template>
              </v-list-item>
            </v-list>

            <div class="d-flex align-center justify-space-between mt-3">
              <span class="text-body-2 text-medium-emphasis">
                {{ copyText.pageLabel }} {{ state.page }} / {{ state.totalPages }}
              </span>
              <div class="d-flex ga-2">
                <v-btn variant="outlined" :disabled="state.page <= 1 || state.loading" @click="onPreviousPage">
                  {{ copyText.previous }}
                </v-btn>
                <v-btn variant="outlined" :disabled="state.page >= state.totalPages || state.loading" @click="onNextPage">
                  {{ copyText.next }}
                </v-btn>
              </div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col v-if="resolvedFeatures.detailPanel" cols="12" lg="7">
        <v-card rounded="lg" elevation="1" border :class="uiClasses.detailCard" :data-testid="uiTestIds.detailCard">
          <v-card-item>
            <v-card-title class="text-subtitle-1 font-weight-bold">{{ copyText.detailTitle }}</v-card-title>
            <v-card-subtitle v-if="state.selectedConversation">
              <template v-if="isWorkspaceMode">
                #{{ state.selectedConversation.id }} • {{ formatDateTime(state.selectedConversation.startedAt) }}
              </template>
              <template v-else>
                #{{ state.selectedConversation.id }} • {{ copyText.workspacePrefix }} {{ state.selectedConversation.workspaceId }}
              </template>
            </v-card-subtitle>
            <v-card-subtitle v-else>{{ copyText.selectConversationHint }}</v-card-subtitle>
            <template #append>
              <v-btn
                variant="outlined"
                :disabled="!state.selectedConversation || state.exportBusy"
                :loading="state.exportBusy"
                @click="onExport"
              >
                {{ copyText.export }}
              </v-btn>
            </template>
          </v-card-item>
          <v-divider />
          <v-card-text>
            <v-alert v-if="state.messagesError" type="error" variant="tonal" class="mb-3">
              {{ state.messagesError }}
            </v-alert>

            <template v-if="state.messagesLoading">
              <v-skeleton-loader type="text, list-item-two-line@3" />
            </template>
            <v-timeline v-else-if="state.messages.length > 0" density="compact" side="end" class="transcript-timeline" :class="uiClasses.timeline">
              <v-timeline-item
                v-for="message in state.messages"
                :key="message.id"
                size="small"
                dot-color="primary"
                fill-dot
              >
                <template #opposite>
                  <span class="text-caption text-medium-emphasis">{{ formatDateTime(message.createdAt) }}</span>
                </template>
                <div class="text-caption text-medium-emphasis mb-1">
                  {{ message.role }} • {{ message.kind }} <span v-if="message.contentRedacted">• {{ copyText.redacted }}</span>
                </div>
                <div class="text-body-2">{{ summarizeContent(message.contentText) }}</div>
              </v-timeline-item>
            </v-timeline>
            <div v-else class="text-body-2 text-medium-emphasis">{{ copyText.emptyMessages }}</div>
            <slot name="detail-extra" :meta="meta" :state="state" :actions="actions" :mode="resolvedMode" />
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <slot name="footer-extra" :meta="meta" :state="state" :actions="actions" :mode="resolvedMode" />
  </section>
</template>

<script setup>
import { computed } from "vue";

const DEFAULT_COPY = Object.freeze({
  workspaceListTitle: "AI transcripts",
  workspaceListSubtitle: "Workspace-scoped assistant conversations.",
  consoleListTitle: "AI transcripts",
  consoleListSubtitle: "Cross-workspace transcript access (console privilege required).",
  detailTitle: "Conversation",
  workspaceIdLabel: "Workspace ID",
  statusLabel: "Status",
  rowsLabel: "Rows",
  userLabel: "User",
  refresh: "Refresh",
  apply: "Apply",
  emptyList: "No transcripts found.",
  emptyConsoleList: "No transcript conversations found.",
  pageLabel: "Page",
  previous: "Previous",
  next: "Next",
  messagesLabel: "messages",
  workspacePrefix: "ws",
  unknown: "unknown",
  selectConversationHint: "Select a conversation to inspect messages.",
  export: "Export",
  loadingConversation: "Loading conversation...",
  redacted: "redacted",
  emptyMessages: "No messages stored for this conversation."
});

const props = defineProps({
  mode: {
    type: String,
    default: "workspace"
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
  features: {
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
  "filters:apply",
  "transcript:select",
  "transcript:export"
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
  if (mode === "console") {
    return "console";
  }
  return "workspace";
});

const isWorkspaceMode = computed(() => resolvedMode.value === "workspace");
const isConsoleMode = computed(() => resolvedMode.value === "console");

const copyText = computed(() => {
  const copy = toRecord(props.copy);
  return {
    ...DEFAULT_COPY,
    listTitle: isConsoleMode.value ? copy.consoleListTitle || DEFAULT_COPY.consoleListTitle : copy.workspaceListTitle || DEFAULT_COPY.workspaceListTitle,
    listSubtitle: isConsoleMode.value
      ? copy.consoleListSubtitle || DEFAULT_COPY.consoleListSubtitle
      : copy.workspaceListSubtitle || DEFAULT_COPY.workspaceListSubtitle,
    emptyList: isConsoleMode.value ? copy.emptyConsoleList || DEFAULT_COPY.emptyConsoleList : copy.emptyList || DEFAULT_COPY.emptyList,
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

const resolvedFeatures = computed(() => {
  const features = toRecord(props.features);
  return {
    listPanel: features.listPanel !== false,
    detailPanel: features.detailPanel !== false,
    statusFilter: features.statusFilter !== false,
    memberFilter: features.memberFilter !== false
  };
});

const uiClasses = computed(() => {
  const classes = toRecord(toRecord(props.ui).classes);
  return {
    listCard: String(classes.listCard || "").trim(),
    detailCard: String(classes.detailCard || "").trim(),
    transcriptList: String(classes.transcriptList || "").trim(),
    timeline: String(classes.timeline || "").trim()
  };
});

const uiTestIds = computed(() => {
  const testIds = toRecord(toRecord(props.ui).testIds);
  return {
    root: String(testIds.root || "assistant-transcript-explorer-client-element"),
    listCard: String(testIds.listCard || "assistant-transcript-list-card"),
    detailCard: String(testIds.detailCard || "assistant-transcript-detail-card")
  };
});

const rootClasses = computed(() => [
  `assistant-transcript-explorer-client-element--layout-${resolvedVariant.value.layout}`,
  `assistant-transcript-explorer-client-element--surface-${resolvedVariant.value.surface}`,
  `assistant-transcript-explorer-client-element--density-${resolvedVariant.value.density}`,
  `assistant-transcript-explorer-client-element--tone-${resolvedVariant.value.tone}`
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
  return String(value || "");
}

function formatTranscriptMode(value) {
  if (typeof meta.formatTranscriptMode === "function") {
    return meta.formatTranscriptMode(value);
  }
  return String(value || "");
}

function summarizeContent(value) {
  if (typeof meta.summarizeContent === "function") {
    return meta.summarizeContent(value);
  }
  return String(value || "");
}

function formatConversationActor(entry) {
  if (typeof meta.formatConversationActor === "function") {
    return meta.formatConversationActor(entry);
  }
  return String(entry?.createdByUserDisplayName || entry?.createdByUserEmail || "Unknown user");
}

async function onRefresh() {
  emitInteraction("refresh");
  await invokeAction("loadConversations", {}, () => actions.loadConversations());
}

async function onApplyFilters() {
  emit("filters:apply", {
    mode: resolvedMode.value
  });
  emitInteraction("filters:apply");
  if (typeof actions.applyFilters === "function") {
    await invokeAction("applyFilters", {}, () => actions.applyFilters());
    return;
  }
  if (typeof actions.loadConversations === "function") {
    await invokeAction("loadConversations", {}, () => actions.loadConversations());
  }
}

async function onStatusFilterChange(value) {
  if (isWorkspaceMode.value && typeof actions.setStatusFilter === "function") {
    await invokeAction("setStatusFilter", { value: String(value || "") }, () => actions.setStatusFilter(value));
    return;
  }
  state.statusFilter = String(value || "");
}

async function onPageSizeChange(value) {
  if (typeof actions.setPageSize === "function") {
    await invokeAction("setPageSize", { value: Number(value || 0) }, () => actions.setPageSize(value));
  }
}

async function onMemberFilterChange(value) {
  if (typeof actions.setMemberFilter === "function") {
    await invokeAction("setMemberFilter", { value: String(value || "") }, () => actions.setMemberFilter(value));
  }
}

async function onSelectConversation(entry) {
  emit("transcript:select", {
    id: Number(entry?.id || 0)
  });
  emitInteraction("transcript:select", {
    id: Number(entry?.id || 0)
  });
  if (typeof actions.selectConversation === "function") {
    await invokeAction("selectConversation", { id: Number(entry?.id || 0) }, () => actions.selectConversation(entry));
  }
}

async function onExport() {
  const conversationId = Number(state.selectedConversation?.id || 0);
  emit("transcript:export", {
    id: conversationId
  });
  emitInteraction("transcript:export", {
    id: conversationId
  });

  if (typeof actions.exportConversation === "function") {
    await invokeAction("exportConversation", { id: conversationId }, () => actions.exportConversation());
    return;
  }

  if (typeof actions.exportSelection === "function") {
    await invokeAction("exportSelection", { id: conversationId }, () => actions.exportSelection());
  }
}

async function onPreviousPage() {
  if (typeof actions.goPreviousPage === "function") {
    await invokeAction("goPreviousPage", {}, () => actions.goPreviousPage());
  }
}

async function onNextPage() {
  if (typeof actions.goNextPage === "function") {
    await invokeAction("goNextPage", {}, () => actions.goNextPage());
  }
}
</script>

<style scoped>
.filters-field {
  min-width: 140px;
  max-width: 220px;
}

.transcript-list {
  max-height: 420px;
  overflow-y: auto;
}

.transcript-timeline {
  max-height: 520px;
  overflow-y: auto;
}
</style>
