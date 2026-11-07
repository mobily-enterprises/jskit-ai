<script setup>
import { computed } from "vue";
import { useJskitText } from "../i18n.js";
import { useShellNavigation, useShellNavigationRuntime } from "../navigation/useShellNavigation.js";

// The top app bar's Up arrow. On an inner page (one that declares meta.jskit.parent) it returns to where the person
// came from or else to that parent, through JSKIT navigation; on a top-level page it renders nothing. On a page that
// closes (useShellPageClose(), such as a new or edit form) it is that page's close (X) instead. ShellLayout's bar
// shows it; a layout that draws its own top app bar puts it first in that bar and calls useShellAppBar().
const { t, text } = useJskitText();
const { canGoUp, up } = useShellNavigation();
const pageClose = useShellNavigationRuntime().pageClose;
const label = computed(() => (pageClose.value ? text(pageClose.value.label()) : t("jskit.shell.actions.back")));

function goUp() {
  void (pageClose.value ? pageClose.value.close() : up());
}
</script>

<template>
  <v-btn
    v-if="canGoUp"
    icon
    variant="text"
    color="on-surface"
    data-testid="jskit-shell-back"
    :aria-label="label"
    :data-action="pageClose ? 'close' : 'up'"
    @click="goUp"
  >
    <v-icon :icon="pageClose ? '$close' : '$arrowBack'" />
    <v-tooltip activator="parent" location="bottom" :text="label" />
  </v-btn>
</template>
