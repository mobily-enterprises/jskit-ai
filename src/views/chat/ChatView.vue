<template>
  <section class="chat-view py-2 py-md-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="text-subtitle-1 font-weight-bold">Chat</v-card-title>
        <v-card-subtitle>Threads, messages, and read state in one place.</v-card-subtitle>
      </v-card-item>
      <v-divider />

      <v-card-text>
        <v-alert v-if="state.actionError" type="error" variant="tonal" density="comfortable" class="mb-3">
          {{ state.actionError }}
        </v-alert>
        <v-alert v-if="state.sendStatus" type="success" variant="tonal" density="comfortable" class="mb-3">
          {{ state.sendStatus }}
        </v-alert>
        <v-alert v-if="state.inboxError" type="error" variant="tonal" density="comfortable" class="mb-3">
          {{ state.inboxError }}
        </v-alert>
        <v-alert v-if="state.messagesError" type="error" variant="tonal" density="comfortable" class="mb-3">
          {{ state.messagesError }}
        </v-alert>

        <div v-if="!state.enabled" class="text-body-2 text-medium-emphasis">
          Chat is unavailable in the current workspace context.
        </div>

        <v-row v-else dense>
          <v-col cols="12" md="4">
            <v-card rounded="lg" border class="h-100">
              <v-card-item>
                <v-card-title class="text-subtitle-2 font-weight-bold">Inbox</v-card-title>
                <template #append>
                  <v-btn variant="text" size="small" :loading="state.inboxLoading" @click="actions.refreshInbox">Refresh</v-btn>
                </template>
              </v-card-item>
              <v-divider />
              <v-card-text class="chat-thread-list-wrapper">
                <v-list nav density="comfortable" class="pa-0 chat-thread-list">
                  <v-list-item v-if="state.inboxLoading && state.threads.length < 1" title="Loading threads..." />
                  <v-list-item v-else-if="state.threads.length < 1" title="No threads yet." />
                  <v-list-item
                    v-for="thread in state.threads"
                    :key="thread.id"
                    :active="Number(thread.id) === Number(state.selectedThreadId)"
                    :title="helpers.formatThreadTitle(thread)"
                    :subtitle="threadSubtitle(thread)"
                    @click="actions.selectThread(thread.id)"
                  >
                    <template #append>
                      <v-chip
                        v-if="Number(thread.unreadCount || 0) > 0"
                        size="x-small"
                        label
                        color="primary"
                        variant="tonal"
                      >
                        {{ thread.unreadCount }}
                      </v-chip>
                    </template>
                  </v-list-item>
                </v-list>

                <div class="d-flex justify-space-between align-center mt-3">
                  <span class="text-caption text-medium-emphasis">Load older thread entries.</span>
                  <v-btn
                    variant="outlined"
                    size="small"
                    :loading="state.loadingMoreThreads"
                    :disabled="!state.hasMoreThreads"
                    @click="actions.loadMoreThreads"
                  >
                    Load more
                  </v-btn>
                </div>
              </v-card-text>
            </v-card>
          </v-col>

          <v-col cols="12" md="8">
            <v-card rounded="lg" border class="h-100">
              <v-card-item>
                <v-card-title class="text-subtitle-2 font-weight-bold">
                  {{ state.selectedThread ? helpers.formatThreadTitle(state.selectedThread) : "Messages" }}
                </v-card-title>
                <v-card-subtitle v-if="state.selectedThread">
                  {{ threadHeaderSubtitle(state.selectedThread) }}
                </v-card-subtitle>
                <template #append>
                  <v-btn
                    variant="text"
                    size="small"
                    :disabled="!state.selectedThreadId || state.messagesLoading"
                    @click="actions.refreshThread"
                  >
                    Refresh
                  </v-btn>
                </template>
              </v-card-item>
              <v-divider />
              <v-card-text>
                <div class="d-flex justify-space-between align-center mb-2">
                  <span class="text-caption text-medium-emphasis">Load older history first, then continue chatting.</span>
                  <v-btn
                    variant="outlined"
                    size="small"
                    :loading="state.loadingMoreMessages"
                    :disabled="!state.selectedThreadId || !state.hasMoreMessages"
                    @click="actions.loadOlderMessages"
                  >
                    Load more
                  </v-btn>
                </div>

                <div class="chat-message-panel">
                  <div v-if="!state.selectedThreadId" class="text-body-2 text-medium-emphasis">
                    Select a thread to start.
                  </div>
                  <div v-else-if="state.messagesLoading && state.messages.length < 1" class="text-body-2 text-medium-emphasis">
                    Loading messages...
                  </div>
                  <div v-else-if="state.messages.length < 1" class="text-body-2 text-medium-emphasis">No messages yet.</div>
                  <v-list v-else density="comfortable" class="pa-0">
                    <v-list-item v-for="message in state.messages" :key="message.id" class="chat-message-row">
                      <template #title>
                        <div class="d-flex flex-wrap align-center ga-2">
                          <span class="text-body-2 font-weight-medium">{{ helpers.formatMessageSender(message) }}</span>
                          <span class="text-caption text-medium-emphasis">{{ helpers.formatTimestamp(message.sentAt) }}</span>
                        </div>
                      </template>
                      <template #subtitle>
                        <div class="chat-message-text text-body-2">{{ helpers.formatMessageText(message) }}</div>
                      </template>
                    </v-list-item>
                  </v-list>
                </div>

                <v-divider class="my-4" />

                <v-textarea
                  v-model="state.composerText"
                  label="Message"
                  rows="2"
                  max-rows="6"
                  auto-grow
                  hide-details="auto"
                  :counter="meta.messageMaxChars"
                  :disabled="!state.selectedThreadId || state.sendPending"
                />

                <div class="d-flex justify-end mt-3">
                  <v-btn color="primary" :loading="state.sendPending" :disabled="!state.canSend" @click="actions.sendFromComposer">
                    Send
                  </v-btn>
                </div>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { useChatView } from "./useChatView.js";

const { meta, state, helpers, actions } = useChatView();

function normalizeText(value) {
  return String(value || "").trim();
}

function threadSubtitle(thread) {
  const preview = helpers.formatThreadPreview(thread);
  const timestamp = thread?.lastMessageAt ? helpers.formatTimestamp(thread.lastMessageAt) : "";
  if (!timestamp) {
    return preview;
  }

  return `${preview} • ${timestamp}`;
}

function threadHeaderSubtitle(thread) {
  const unreadCount = Number(thread?.unreadCount || 0);
  const readState = unreadCount > 0 ? `${unreadCount} unread` : "All read";
  const scope = normalizeText(thread?.scopeKind) || "thread";
  const lastMessageAt = thread?.lastMessageAt ? helpers.formatTimestamp(thread.lastMessageAt) : "No activity yet";
  return `${scope} • ${readState} • ${lastMessageAt}`;
}
</script>

<style scoped>
.chat-thread-list-wrapper {
  display: flex;
  flex-direction: column;
  min-height: 420px;
}

.chat-thread-list {
  flex: 1;
  overflow: auto;
}

.chat-message-panel {
  min-height: 300px;
  max-height: 480px;
  overflow: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 12px;
  padding: 0.5rem;
}

.chat-message-row + .chat-message-row {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

.chat-message-text {
  white-space: pre-wrap;
  line-height: 1.35;
}
</style>
