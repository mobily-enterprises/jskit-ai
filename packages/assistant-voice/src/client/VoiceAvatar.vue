<script setup>
import { computed } from "vue";
import { useVoiceAvatar } from "./voiceAvatar.js";
const props = defineProps({ state: { type: String, default: "idle" }, mouthPose: { type: String, default: "closed" }, mouthLevel: { type: Number, default: 0 } });
const { blinking, visibleMouthPose, reducedMotion } = useVoiceAvatar(props);
const mouthHeight = computed(() => reducedMotion.value || visibleMouthPose.value === "closed" ? 3 : Math.max(4, Math.min(18, props.mouthLevel * 28)));
</script>
<template>
  <svg viewBox="0 0 128 128" aria-label="Assistant avatar" role="img" class="voice-avatar">
    <circle cx="64" cy="64" r="59" fill="currentColor" opacity=".1" />
    <rect x="25" y="31" width="78" height="66" rx="24" fill="none" stroke="currentColor" stroke-width="3" />
    <path d="M64 31V21" stroke="currentColor" stroke-width="3" />
    <circle cx="64" cy="18" r="4" fill="currentColor" />
    <ellipse v-for="x in [47,81]" :key="x" :cx="x" cy="55" rx="5" :ry="blinking ? 1 : 7" fill="currentColor" />
    <ellipse cx="64" cy="77" :rx="visibleMouthPose === 'round' ? 6 : 15" :ry="mouthHeight" fill="currentColor" />
  </svg>
</template>
<style scoped>.voice-avatar { color: rgb(var(--v-theme-primary)); width: 100%; height: 100%; }</style>
