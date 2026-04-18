<template>
  <aside class="docs-terminal-tip">
    <div class="docs-terminal-tip__header">
      <span class="docs-terminal-tip__eyebrow">{{ label }}</span>
      <strong class="docs-terminal-tip__title">{{ title }}</strong>
    </div>
    <div class="docs-terminal-tip__body">
      <slot />
    </div>
  </aside>
</template>

<script setup>
defineProps({
  label: {
    type: String,
    default: "Terminal"
  },
  title: {
    type: String,
    default: "Try This"
  }
});
</script>
