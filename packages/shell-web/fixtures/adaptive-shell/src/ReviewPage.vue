<script setup>
import { useRoute } from "vue-router";
import ShellPageAction from "../../../src/client/components/ShellPageAction.vue";
import ShellPageActions from "../../../src/client/components/ShellPageActions.vue";
import { useShellPageTitle } from "../../../src/client/composables/useShellPageTitle.js";

// A record page with whs2's two actions, Close and the primary Submit, for the room a bar gives them beside its title
// and its own items. `?title=` sets the page's title.
const route = useRoute();

useShellPageTitle(() => String(route.query.title || "Module record"));
</script>

<template>
  <section class="pa-4">
    <ShellPageActions>
      <ShellPageAction icon="$close" label="Close" data-testid="fixture-review-close" />
      <ShellPageAction primary icon="$check" label="Submit" data-testid="fixture-review-submit" />
    </ShellPageActions>
    <p>A record to review.</p>
  </section>
</template>
