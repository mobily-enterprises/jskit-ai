<template>
  <aside :class="['docs-in-depth', { 'is-open': open }]" :style="{ '--docs-in-depth-preview-height': previewHeight }">
    <button
      class="docs-in-depth__toggle"
      type="button"
      :aria-expanded="open ? 'true' : 'false'"
      @click="open = !open"
    >
      <span class="docs-in-depth__title">{{ title }}</span>
      <span class="docs-in-depth__state">{{ open ? "Hide details" : "Show details" }}</span>
      <span class="docs-in-depth__chevron" aria-hidden="true">⌄</span>
    </button>

    <div class="docs-in-depth__frame">
      <div class="docs-in-depth__content">
        <slot />
      </div>
    </div>
  </aside>
</template>

<script setup>
import { ref } from "vue";

defineProps({
  title: {
    type: String,
    default: "In depth"
  },
  previewHeight: {
    type: String,
    default: "14rem"
  }
});

const open = ref(false);
</script>
