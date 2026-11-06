<script setup>
import { SHELL_PAGE_ACTIONS_ID } from "../support/navigationPresentation.js";

// Where the current page's ShellPageActions show: after the page title in the top app bar. ShellLayout's bar has it;
// a layout that draws its own top app bar renders it once there and calls useShellAppBar().
</script>

<template>
  <div :id="SHELL_PAGE_ACTIONS_ID" class="shell-page-actions-target" />
</template>

<style scoped>
.shell-page-actions-target {
  align-items: center;
  color: rgb(var(--v-theme-on-surface-variant));
  display: flex;
  flex: 0 0 auto;
  min-width: 0;
}

.shell-page-actions-target:empty {
  display: none;
}
</style>
