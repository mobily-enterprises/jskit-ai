<template>
  <ChatClientElement :meta="meta" :state="state" :helpers="helpers" :actions="actions" />
</template>

<script setup>
import { ChatClientElement } from "@jskit-ai/chat-client-element";
import { useChatView } from "../../modules/chat/runtime.js";

const { meta, state, helpers, actions } = useChatView();
</script>
