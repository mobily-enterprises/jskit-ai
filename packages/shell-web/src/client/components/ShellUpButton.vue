<script setup>
import { useJskitText } from "../i18n.js";
import { useShellNavigation } from "../navigation/useShellNavigation.js";

// The top app bar's Up arrow. On an inner page (one that declares meta.jskit.parent) it returns to where the person
// came from or else to that parent, through JSKIT navigation; on a top-level page it renders nothing. ShellLayout's
// bar shows it; a layout that draws its own top app bar puts it first in that bar and calls useShellAppBar().
const { t } = useJskitText();
const { canGoUp, up } = useShellNavigation();

function goUp() {
  void up();
}
</script>

<template>
  <v-btn
    v-if="canGoUp"
    icon
    variant="text"
    color="on-surface"
    data-testid="jskit-shell-back"
    :aria-label="t('jskit.shell.actions.back')"
    @click="goUp"
  >
    <v-icon icon="$arrowBack" />
    <v-tooltip activator="parent" location="bottom" :text="t('jskit.shell.actions.back')" />
  </v-btn>
</template>
