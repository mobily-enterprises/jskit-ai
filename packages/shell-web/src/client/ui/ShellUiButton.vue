<script setup>
// The kit's Material button (shell-web's Button role), a Vuetify button: each emphasis is a Material 3 button type and
// each tone a colour role. A view's other attributes (class, data-testid, form, aria-*) and listeners reach the button.
// `type` applies to a button, `href` makes it a link.
const props = defineProps({
  // high: the screen's main action. medium: a secondary action with a fill. subtle: a secondary action drawn with an
  // outline, such as one of several equal choices. low: an action drawn as text alone.
  emphasis: { type: String, default: "medium", validator: (value) => ["high", "medium", "subtle", "low"].includes(value) },
  tone: { type: String, default: "accent", validator: (value) => ["accent", "neutral", "danger"].includes(value) },
  // large: a form's main action, drawn bigger.
  size: { type: String, default: "default", validator: (value) => ["default", "large"].includes(value) },
  type: { type: String, default: "button" },
  disabled: { type: Boolean, default: false },
  // The action is running.
  pending: { type: Boolean, default: false },
  // The button takes the whole width of its container.
  block: { type: Boolean, default: false },
  href: { type: String, default: undefined },
  // A leading icon, as an icon alias ("$google").
  icon: { type: String, default: undefined }
});

const VARIANTS = Object.freeze({ high: "flat", medium: "tonal", subtle: "outlined", low: "text" });
const COLORS = Object.freeze({ accent: "primary", neutral: "secondary", danger: "error" });
</script>

<template>
  <v-btn
    :variant="VARIANTS[props.emphasis]"
    :color="COLORS[props.tone]"
    :size="props.size"
    :type="props.href ? undefined : props.type"
    :href="props.href"
    :disabled="props.disabled"
    :loading="props.pending"
    :block="props.block"
    :prepend-icon="props.icon"
  >
    <slot />
  </v-btn>
</template>
