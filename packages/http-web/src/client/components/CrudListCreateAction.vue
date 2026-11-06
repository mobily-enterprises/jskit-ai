<script setup>
import ShellPageAction from "@jskit-ai/shell-web/client/components/ShellPageAction";
import ShellPageActions from "@jskit-ai/shell-web/client/components/ShellPageActions";
import { useShellWindowSizeClass } from "@jskit-ai/shell-web/client/composables/useShellWindowSizeClass";

// A list's create action as Material 3 places it: an extended FAB above the navigation bar or beside the rail on
// compact and medium windows, the app bar's filled primary action on expanded and large ones. Its layout order puts
// it inside the shell's navigation bar, so the FAB sits above the bar instead of over it.
const props = defineProps({
  label: {
    type: String,
    required: true
  },
  to: {
    type: [String, Object],
    required: true
  }
});

const { isCompact, isMedium } = useShellWindowSizeClass();
</script>

<template>
  <v-fab
    v-if="isCompact || isMedium"
    class="crud-list-fab"
    app
    extended
    location="bottom end"
    order="1"
    prepend-icon="$add"
    :text="props.label"
    :to="props.to"
  />
  <ShellPageActions v-else>
    <ShellPageAction primary icon="$add" :label="props.label" :to="props.to" />
  </ShellPageActions>
</template>
