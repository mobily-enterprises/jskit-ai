<script setup>
import WorkspaceNotFoundCard from "@/components/WorkspaceNotFoundCard.vue";
import { useWorkspaceNotFoundState } from "@/composables/useWorkspaceNotFoundState";

const { workspaceUnavailable, workspaceUnavailableMessage } = useWorkspaceNotFoundState();
</script>

<template>
  <WorkspaceNotFoundCard
    v-if="workspaceUnavailable"
    :message="workspaceUnavailableMessage"
    surface-label="App"
  />
  <section v-else class="workspace-home-screen d-flex flex-column ga-4">
    <div class="workspace-home-screen__panel">
      <p class="text-body-medium on-surface-variant mb-0">
        Activity from workspace workflows will appear here.
      </p>
    </div>
  </section>
</template>

<style scoped>
.workspace-home-screen__panel {
  margin-inline: auto;
  max-width: 34rem;
  padding: 2rem 1.25rem;
  text-align: center;
  width: 100%;
}
</style>
