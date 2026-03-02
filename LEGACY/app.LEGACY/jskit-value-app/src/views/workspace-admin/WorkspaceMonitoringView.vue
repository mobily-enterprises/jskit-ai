<template>
  <section class="workspace-monitoring-view py-2 py-md-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="text-h6">Monitoring</v-card-title>
        <v-card-subtitle>Workspace-level AI usage visibility and activity oversight.</v-card-subtitle>
      </v-card-item>
      <v-divider />

      <v-tabs :model-value="activeTab" color="primary" density="comfortable" @update:model-value="handleTabChange">
        <v-tab value="transcripts" :disabled="!canViewAiTranscripts">AI transcripts</v-tab>
        <v-tab value="audit">Audit/Activity logs</v-tab>
      </v-tabs>
      <v-divider />

      <v-window :model-value="activeTab" class="monitoring-window">
        <v-window-item value="transcripts">
          <div v-if="canViewAiTranscripts" class="tab-panel-content">
            <WorkspaceTranscriptsView />
          </div>
          <v-alert v-else type="info" variant="tonal" class="ma-4">
            You do not have permission to view AI transcripts for this workspace.
          </v-alert>
        </v-window-item>

        <v-window-item value="audit">
          <div class="tab-panel-content">
            <WorkspaceAuditActivityLogsView />
          </div>
        </v-window-item>
      </v-window>
    </v-card>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { useWorkspaceStore } from "../../app/state/workspaceStore.js";
import WorkspaceTranscriptsView from "../workspace-transcripts/WorkspaceTranscriptsView.vue";
import WorkspaceAuditActivityLogsView from "./WorkspaceAuditActivityLogsView.vue";

const TAB_TRANSCRIPTS = "transcripts";
const TAB_AUDIT = "audit";

const navigate = useNavigate();
const workspaceStore = useWorkspaceStore();
const currentPath = useRouterState({
  select: (state) => state.location.pathname
});

const canViewAiTranscripts = computed(() => workspaceStore.can("workspace.ai.transcripts.read"));

const monitoringPath = computed(() => workspaceStore.workspacePath("/admin/monitoring", { surface: "admin" }));
const transcriptsPath = computed(() =>
  workspaceStore.workspacePath("/admin/monitoring/transcripts", { surface: "admin" })
);
const auditPath = computed(() =>
  workspaceStore.workspacePath("/admin/monitoring/audit-activity", { surface: "admin" })
);

const activeTab = computed(() => {
  const path = String(currentPath.value || "");
  if (path.endsWith("/admin/monitoring/audit-activity")) {
    return TAB_AUDIT;
  }

  if (!canViewAiTranscripts.value) {
    return TAB_AUDIT;
  }

  return TAB_TRANSCRIPTS;
});

async function handleTabChange(nextTab) {
  const normalizedTab = String(nextTab || "")
    .trim()
    .toLowerCase();

  if (normalizedTab === TAB_AUDIT) {
    await navigate({ to: auditPath.value });
    return;
  }

  if (!canViewAiTranscripts.value) {
    return;
  }

  await navigate({ to: transcriptsPath.value });
}

if (!canViewAiTranscripts.value && currentPath.value === monitoringPath.value) {
  void navigate({ to: auditPath.value, replace: true });
}
</script>

<style scoped>
.monitoring-window {
  background-color: rgb(var(--v-theme-surface));
}

.tab-panel-content {
  padding: 0.25rem 0.5rem 0.5rem;
}
</style>
