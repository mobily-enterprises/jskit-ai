<template>
  <section class="workspace-members-view py-2 py-md-4">
    <MembersAdminClientElement
      mode="workspace"
      :forms="forms"
      :options="options"
      :collections="members"
      :permissions="permissions"
      :feedback="feedback"
      :status="status"
      :actions="actions"
    />
  </section>
</template>

<script setup>
import { MembersAdminClientElement } from "@jskit-ai/members-admin-client-element";
import { useWorkspaceSettingsView } from "../workspace-settings/useWorkspaceSettingsView.js";

const { forms, options, feedback, members, permissions, status, actions } = useWorkspaceSettingsView();
</script>
