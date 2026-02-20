<template>
  <section class="workspace-transcripts-view py-2 py-md-4">
    <v-row>
      <v-col cols="12" lg="5">
        <v-card rounded="lg" elevation="1" border>
          <v-card-item>
            <v-card-title class="text-subtitle-1 font-weight-bold">AI transcripts</v-card-title>
            <v-card-subtitle>Workspace-scoped assistant conversations.</v-card-subtitle>
          </v-card-item>
          <v-divider />
          <v-card-text>
            <v-alert v-if="state.error" type="error" variant="tonal" class="mb-3">
              {{ state.error }}
            </v-alert>

            <div class="d-flex flex-wrap ga-3 align-center mb-3">
              <v-select
                :model-value="state.statusFilter"
                :items="meta.statusOptions"
                item-title="title"
                item-value="value"
                label="Status"
                density="compact"
                variant="outlined"
                hide-details
                class="filters-select"
                @update:model-value="actions.setStatusFilter"
              />
              <v-select
                :model-value="state.pageSize"
                :items="meta.pageSizeOptions"
                label="Rows"
                density="compact"
                variant="outlined"
                hide-details
                class="filters-select"
                @update:model-value="actions.setPageSize"
              />
              <v-btn variant="outlined" :loading="state.loading" @click="actions.loadConversations">Refresh</v-btn>
            </div>

            <v-list density="comfortable" class="pa-0 transcript-list">
              <v-list-item v-if="!state.entries.length" title="No transcripts found." />
              <v-list-item
                v-for="entry in state.entries"
                :key="entry.id"
                :active="state.selectedConversation?.id === entry.id"
                @click="actions.selectConversation(entry)"
              >
                <template #title>
                  <div class="d-flex align-center ga-2">
                    <span>#{{ entry.id }}</span>
                    <v-chip size="x-small" label>{{ entry.status }}</v-chip>
                  </div>
                </template>
                <template #subtitle>
                  <div class="text-caption text-medium-emphasis">
                    {{ meta.formatDateTime(entry.startedAt) }} • {{ meta.formatTranscriptMode(entry.transcriptMode) }} •
                    {{ entry.messageCount }} messages
                  </div>
                </template>
              </v-list-item>
            </v-list>

            <div class="d-flex align-center justify-space-between mt-3">
              <span class="text-body-2 text-medium-emphasis">Page {{ state.page }} / {{ state.totalPages }}</span>
              <div class="d-flex ga-2">
                <v-btn variant="outlined" :disabled="state.page <= 1 || state.loading" @click="actions.goPreviousPage">
                  Previous
                </v-btn>
                <v-btn
                  variant="outlined"
                  :disabled="state.page >= state.totalPages || state.loading"
                  @click="actions.goNextPage"
                >
                  Next
                </v-btn>
              </div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" lg="7">
        <v-card rounded="lg" elevation="1" border>
          <v-card-item>
            <v-card-title class="text-subtitle-1 font-weight-bold">Conversation</v-card-title>
            <v-card-subtitle v-if="state.selectedConversation">
              #{{ state.selectedConversation.id }} • {{ meta.formatDateTime(state.selectedConversation.startedAt) }}
            </v-card-subtitle>
            <v-card-subtitle v-else>Select a conversation to inspect messages.</v-card-subtitle>
            <template #append>
              <v-btn
                variant="outlined"
                :disabled="!state.selectedConversation || state.exportBusy"
                :loading="state.exportBusy"
                @click="actions.exportConversation"
              >
                Export
              </v-btn>
            </template>
          </v-card-item>
          <v-divider />
          <v-card-text>
            <v-alert v-if="state.messagesError" type="error" variant="tonal" class="mb-3">
              {{ state.messagesError }}
            </v-alert>

            <div v-if="state.messagesLoading" class="text-body-2 text-medium-emphasis">Loading conversation...</div>
            <v-timeline v-else-if="state.messages.length > 0" density="compact" side="end" class="transcript-timeline">
              <v-timeline-item
                v-for="message in state.messages"
                :key="message.id"
                size="small"
                dot-color="primary"
                fill-dot
              >
                <template #opposite>
                  <span class="text-caption text-medium-emphasis">{{ meta.formatDateTime(message.createdAt) }}</span>
                </template>
                <div class="text-caption text-medium-emphasis mb-1">
                  {{ message.role }} • {{ message.kind }} <span v-if="message.contentRedacted">• redacted</span>
                </div>
                <div class="text-body-2">{{ meta.summarizeContent(message.contentText) }}</div>
              </v-timeline-item>
            </v-timeline>
            <div v-else class="text-body-2 text-medium-emphasis">No messages stored for this conversation.</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </section>
</template>

<script setup>
import { useWorkspaceTranscriptsView } from "./useWorkspaceTranscriptsView.js";

const { meta, state, actions } = useWorkspaceTranscriptsView();
</script>

<style scoped>
.filters-select {
  min-width: 140px;
  max-width: 180px;
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
