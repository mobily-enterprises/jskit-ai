<template>
  <section class="console-members-view py-2 py-md-4">
    <MembersAdminClientElement
      mode="console"
      :forms="forms"
      :options="options"
      :collections="collections"
      :permissions="permissions"
      :feedback="feedback"
      :status="status"
      :actions="actions"
    />
  </section>
</template>

<script setup>
import { MembersAdminClientElement } from "@jskit-ai/members-admin-client-element/client";
import { useConsoleMembersView } from "./useConsoleMembersView.js";

const { forms, options, collections, permissions, feedback, status, actions } = useConsoleMembersView();
</script>
