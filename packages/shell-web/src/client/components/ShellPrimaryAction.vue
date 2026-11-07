<script setup>
import { useShellWindowSizeClass } from "../composables/useShellWindowSizeClass.js";
import { useJskitText } from "../i18n.js";
import ShellPageAction from "./ShellPageAction.vue";
import ShellPageActions from "./ShellPageActions.vue";

// A screen's primary action, such as a list's "New", as Material 3 places it: an extended FAB above the navigation
// bar or beside the rail on compact and medium windows, the app bar's filled primary action on expanded and large
// ones. It goes to `to`, or runs its click handler (a "New" that opens a dialog). Its layout order puts the FAB inside
// the shell's navigation bar, so it sits above the bar instead of over it, and it takes layout room (`layout`), so the
// shell's snackbar shows above it and the screen's last card scrolls clear of it. Attributes and the click handler land on
// the FAB, or on the bar's button.
defineOptions({ inheritAttrs: false });

const props = defineProps({
  // A message key, { key, fallback } or plain text.
  label: {
    type: [String, Object],
    required: true
  },
  icon: {
    type: String,
    default: "$add"
  },
  to: {
    type: [String, Object],
    default: undefined
  },
  disabled: {
    type: Boolean,
    default: false
  },
  loading: {
    type: Boolean,
    default: false
  }
});
const { text } = useJskitText();
const { isCompact, isMedium } = useShellWindowSizeClass();
</script>

<template>
  <v-fab
    v-if="isCompact || isMedium"
    v-bind="$attrs"
    class="shell-primary-action"
    app
    layout
    extended
    location="bottom end"
    order="1"
    :prepend-icon="props.icon"
    :text="text(props.label)"
    :to="props.to"
    :disabled="props.disabled"
    :loading="props.loading"
  />
  <ShellPageActions v-else>
    <ShellPageAction
      v-bind="$attrs"
      primary
      :icon="props.icon"
      :label="props.label"
      :to="props.to"
      :disabled="props.disabled"
      :loading="props.loading"
    />
  </ShellPageActions>
</template>
