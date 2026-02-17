<template>
  <section class="workspaces-view py-6">
    <v-container class="mx-auto" max-width="760">
      <v-card rounded="lg" border elevation="1">
        <v-card-item>
          <v-card-title class="text-h6">You are logged in</v-card-title>
          <v-card-subtitle>Select a workspace to continue.</v-card-subtitle>
        </v-card-item>
        <v-divider />

        <v-card-text class="pt-4">
          <v-alert v-if="message" :type="messageType" variant="tonal" class="mb-4">
            {{ message }}
          </v-alert>

          <template v-if="workspaceItems.length === 0">
            <p class="text-body-1 mb-2">You do not have a workspace yet.</p>
            <p class="text-body-2 text-medium-emphasis mb-0">
              Ask an administrator for an invite, or create one after policy is enabled.
            </p>
          </template>

          <template v-else>
            <v-list density="comfortable" class="pa-0">
              <v-list-item
                v-for="workspace in workspaceItems"
                :key="workspace.id"
                :title="workspace.name"
                :subtitle="`/${workspace.slug} • role: ${workspace.roleId || 'member'}`"
                class="px-0"
              >
                <template #append>
                  <v-btn
                    color="primary"
                    size="small"
                    variant="tonal"
                    :loading="selectingWorkspaceSlug === workspace.slug"
                    @click="openWorkspace(workspace.slug)"
                  >
                    Open workspace
                  </v-btn>
                </template>
              </v-list-item>
            </v-list>
          </template>
        </v-card-text>
      </v-card>
    </v-container>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useNavigate } from "@tanstack/vue-router";
import { useWorkspaceStore } from "../stores/workspaceStore";

const navigate = useNavigate();
const workspaceStore = useWorkspaceStore();

const message = ref("");
const messageType = ref("error");
const selectingWorkspaceSlug = ref("");

const workspaceItems = computed(() => (Array.isArray(workspaceStore.workspaces) ? workspaceStore.workspaces : []));

async function openWorkspace(workspaceSlug) {
  selectingWorkspaceSlug.value = String(workspaceSlug || "");
  message.value = "";

  try {
    const result = await workspaceStore.selectWorkspace(workspaceSlug);
    const slug = String(result?.workspace?.slug || workspaceSlug || "");
    await navigate({
      to: `/w/${slug}`,
      replace: true
    });
  } catch (error) {
    messageType.value = "error";
    message.value = String(error?.message || "Unable to open workspace.");
  } finally {
    selectingWorkspaceSlug.value = "";
  }
}

onMounted(async () => {
  try {
    await workspaceStore.refreshBootstrap();
  } catch (error) {
    messageType.value = "error";
    message.value = String(error?.message || "Unable to load workspaces.");
    return;
  }

  if (workspaceStore.hasActiveWorkspace && workspaceStore.activeWorkspaceSlug) {
    await navigate({
      to: `/w/${workspaceStore.activeWorkspaceSlug}`,
      replace: true
    });
    return;
  }

  if (workspaceItems.value.length === 1) {
    await openWorkspace(workspaceItems.value[0].slug);
  }
});
</script>
