<script setup>
import { useRoute } from "vue-router";
import WorkspaceNotFoundCard from "@/components/WorkspaceNotFoundCard.vue";
import { useWorkspaceNotFoundState } from "@/composables/useWorkspaceNotFoundState";

const route = useRoute();
const { workspaceUnavailable, workspaceUnavailableMessage } = useWorkspaceNotFoundState();

function adminChildPath(suffix = "") {
  const basePath = String(route.path || "").replace(/\/+$/u, "");
  const childPath = String(suffix || "").replace(/^\/+|\/+$/gu, "");
  return childPath ? `${basePath}/${childPath}` : basePath;
}
</script>

<template>
  <WorkspaceNotFoundCard
    v-if="workspaceUnavailable"
    :message="workspaceUnavailableMessage"
    surface-label="Admin"
  />
  <section v-else class="workspace-admin-screen d-flex flex-column ga-4">
    <header class="workspace-admin-screen__header">
      <div>
        <p class="text-overline text-medium-emphasis mb-1">Admin</p>
        <h1 class="workspace-admin-screen__title">Workspace Admin</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">Manage members and workspace settings.</p>
      </div>
      <div class="workspace-admin-screen__actions">
        <v-btn color="primary" variant="flat" :to="adminChildPath('members')">Members</v-btn>
        <v-btn color="primary" variant="tonal" :to="adminChildPath('workspace/settings')">Settings</v-btn>
      </div>
    </header>

    <v-sheet rounded="lg" border class="workspace-admin-screen__panel">
      <h2 class="text-h6 mb-2">Admin tasks</h2>
      <p class="text-body-2 text-medium-emphasis mb-0">
        Review workspace access, members, and operational settings from this surface.
      </p>
    </v-sheet>
  </section>
</template>

<style scoped>
.workspace-admin-screen__header {
  align-items: flex-start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.workspace-admin-screen__title {
  font-size: clamp(1.5rem, 2.5vw, 2.25rem);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.1;
  margin: 0 0 0.4rem;
}

.workspace-admin-screen__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
}

.workspace-admin-screen__panel {
  padding: 1rem;
}

@media (max-width: 640px) {
  .workspace-admin-screen__header {
    flex-direction: column;
  }

  .workspace-admin-screen__actions {
    width: 100%;
  }

  .workspace-admin-screen__actions :deep(.v-btn) {
    min-height: 48px;
    flex: 1 1 10rem;
  }
}
</style>
