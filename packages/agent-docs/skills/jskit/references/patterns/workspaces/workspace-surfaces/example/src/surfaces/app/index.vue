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
    <v-sheet rounded="lg" border class="workspace-home-screen__panel">
      <p class="text-body-2 text-medium-emphasis mb-0">
        Activity from workspace workflows will appear here.
      </p>
    </v-sheet>
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
