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
    <header>
      <p class="text-overline text-medium-emphasis mb-1">Workspace</p>
      <h1 class="workspace-home-screen__title">Workspace Home</h1>
      <p class="text-body-2 text-medium-emphasis mb-0">The current workspace is active.</p>
    </header>

    <v-sheet rounded="lg" border class="workspace-home-screen__panel">
      <h2 class="text-h6 mb-2">No workspace activity yet</h2>
      <p class="text-body-2 text-medium-emphasis mb-0">
        Activity from workspace workflows will appear here.
      </p>
    </v-sheet>
  </section>
</template>

<style scoped>
.workspace-home-screen__title {
  font-size: clamp(1.5rem, 2.5vw, 2.25rem);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.1;
  margin: 0 0 0.4rem;
}

.workspace-home-screen__panel {
  margin-inline: auto;
  max-width: 34rem;
  padding: 2rem 1.25rem;
  text-align: center;
  width: 100%;
}
</style>
