<template>
  <ChatClientElement :meta="meta" :state="state" :helpers="helpers" :actions="actions" />
</template>

<script setup>
import { ChatClientElement } from "@jskit-ai/chat-client-element/client";
import { useWorkspaceChatView } from "./useWorkspaceChatView.js";

const { meta, state, helpers, actions } = useWorkspaceChatView();
</script>
