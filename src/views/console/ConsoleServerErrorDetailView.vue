<template>
  <section class="console-error-detail-view py-2 py-md-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-title class="d-flex flex-wrap align-center ga-3">
        <span class="text-subtitle-1 font-weight-bold">Server error details</span>
        <v-spacer />
        <v-btn variant="outlined" :loading="state.loading" @click="actions.refresh">Refresh</v-btn>
        <v-btn variant="text" @click="actions.goBack">Back to server errors</v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-alert v-if="!state.hasValidErrorId" type="error" variant="tonal" class="mb-3">
          Invalid server error id.
        </v-alert>

        <v-alert v-if="state.error" type="error" variant="tonal" class="mb-3">
          {{ state.error }}
        </v-alert>

        <div v-if="state.loading" class="text-medium-emphasis py-8">Loading server error details...</div>

        <template v-else-if="state.entry">
          <dl class="detail-grid">
            <dt>ID</dt>
            <dd>#{{ state.entry.id }}</dd>

            <dt>Captured</dt>
            <dd>{{ meta.formatDateTime(state.entry.createdAt) }}</dd>

            <dt>Status</dt>
            <dd>
              <v-chip size="small" label color="error" variant="tonal">{{ state.entry.statusCode }}</v-chip>
            </dd>

            <dt>Request</dt>
            <dd>{{ meta.formatRequest(state.entry) }}</dd>

            <dt>Request ID</dt>
            <dd>{{ state.entry.requestId || "unknown" }}</dd>

            <dt>User</dt>
            <dd>{{ state.entry.username || (state.entry.userId ? `#${state.entry.userId}` : "anonymous") }}</dd>
          </dl>

          <h3 class="text-subtitle-2 mt-4 mb-2">Message</h3>
          <pre class="detail-pre">{{ meta.summarizeServerMessage(state.entry) }}</pre>

          <h3 class="text-subtitle-2 mt-4 mb-2">Stack</h3>
          <pre class="detail-pre">{{ state.entry.stack || "No stack captured." }}</pre>

          <h3 class="text-subtitle-2 mt-4 mb-2">Metadata</h3>
          <pre class="detail-pre">{{ meta.formatJson(state.entry.metadata) }}</pre>
        </template>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { useConsoleServerErrorDetailView } from "./useConsoleServerErrorDetailView.js";

const { meta, state, actions } = useConsoleServerErrorDetailView();
</script>

<style scoped>
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
</style>
