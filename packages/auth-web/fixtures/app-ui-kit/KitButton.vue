<script setup>
// The application's own button, as its design system draws one: a plain element that shows each prop of shell-web's
// Button role, so a test can read which emphasis, tone and size a view asked for.
defineProps({
  emphasis: { type: String, default: "medium" },
  tone: { type: String, default: "accent" },
  size: { type: String, default: "default" },
  type: { type: String, default: "button" },
  disabled: { type: Boolean, default: false },
  pending: { type: Boolean, default: false },
  block: { type: Boolean, default: false },
  href: { type: String, default: "" },
  icon: { type: String, default: "" }
});
</script>

<template>
  <a
    v-if="href"
    class="kit-button"
    :href="href"
    :data-emphasis="emphasis"
    :data-tone="tone"
    :data-size="size"
    :data-block="block ? 'true' : undefined"
    :data-icon="icon || undefined"
  >
    <slot />
  </a>
  <button
    v-else
    class="kit-button"
    :type="type"
    :disabled="disabled"
    :aria-busy="pending ? 'true' : undefined"
    :data-emphasis="emphasis"
    :data-tone="tone"
    :data-size="size"
    :data-block="block ? 'true' : undefined"
    :data-icon="icon || undefined"
  >
    <slot />
  </button>
</template>

<style scoped>
.kit-button {
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 15px;
  background: #e3e3e8;
  color: #1b1b1f;
  font: inherit;
  font-size: 13px;
}

.kit-button[data-emphasis="high"] {
  background: #2e3036;
  color: #f1f0f7;
}

.kit-button[data-tone="danger"] {
  background: #ba1a1a;
  color: #ffffff;
}
</style>
