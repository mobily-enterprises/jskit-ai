<script setup>
import { ChatClientElement } from "@jskit-ai/chat-client-element";
</script>

<template>
  <section class="chat-page">
    <header class="chat-page__header">
      <h1>Chat</h1>
      <p>Workspace messaging surface.</p>
    </header>
    <ChatClientElement />
  </section>
</template>

<style scoped>
.chat-page {
  display: grid;
  gap: 1rem;
}

.chat-page__header {
  display: grid;
  gap: 0.25rem;
}

.chat-page__header h1 {
  margin: 0;
  font-size: 1.5rem;
}

.chat-page__header p {
  margin: 0;
  color: #4b5563;
}
</style>
