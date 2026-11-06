<script setup>
import { inject } from "vue";
import {
  NO_SHELL_PAGE_ACTIONS_TARGET,
  SHELL_PAGE_ACTIONS_TARGET_KEY
} from "../support/navigationPresentation.js";

/**
 * The app bar's actions target. The current page's actions show in the shell's top app bar after the page title
 * (Material 3 puts a page's actions there); put ShellPageAction buttons inside. Outside a ShellLayout they render
 * where they are written.
 * @type {string}
 */
const target = inject(SHELL_PAGE_ACTIONS_TARGET_KEY, NO_SHELL_PAGE_ACTIONS_TARGET);
</script>

<template>
  <Teleport defer :to="target || 'body'" :disabled="!target">
    <div class="shell-page-actions" data-testid="jskit-shell-page-actions">
      <slot />
    </div>
  </Teleport>
</template>

<style scoped>
.shell-page-actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 0;
}
</style>
