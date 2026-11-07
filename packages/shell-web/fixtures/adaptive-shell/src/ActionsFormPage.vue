<script setup>
import ShellPageAction from "../../../src/client/components/ShellPageAction.vue";
import ShellPageActions from "../../../src/client/components/ShellPageActions.vue";
import { useShellPageClose } from "../../../src/client/composables/useShellPageClose.js";
import { usePaths } from "../../../src/client/navigation/usePaths.js";
import { useShellNavigation } from "../../../src/client/navigation/useShellNavigation.js";

// A new page that saves to its list (finish with a target) and closes back to where it was opened (finish()): its Up
// arrow is the close.
const paths = usePaths();
const { finish } = useShellNavigation();
useShellPageClose({ label: "Cancel", close: () => finish() });
</script>

<template>
  <section class="pa-4">
    <ShellPageActions>
      <ShellPageAction primary label="Save" @click="finish(paths.page('/actions'))" />
    </ShellPageActions>
    <p>A new entry.</p>
  </section>
</template>
