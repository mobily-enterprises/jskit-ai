<template>
  <section class="chat-screen">
    <ChatView />
  </section>
</template>

<script setup>
import ChatView from "./ChatView.vue";
</script>

<style scoped>
.chat-screen {
  min-height: 100vh;
  padding: 0.85rem clamp(0.6rem, 2vw, 1.5rem) 1.1rem;
  background:
    radial-gradient(circle at 0% 0%, rgba(var(--v-theme-primary), 0.08), rgba(var(--v-theme-primary), 0) 40%),
    rgb(var(--v-theme-background));
}
</style>
