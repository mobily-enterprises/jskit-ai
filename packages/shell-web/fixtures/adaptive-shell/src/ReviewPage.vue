<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import ShellPageAction from "../../../src/client/components/ShellPageAction.vue";
import ShellPageActions from "../../../src/client/components/ShellPageActions.vue";
import { useShellPageTitle } from "../../../src/client/composables/useShellPageTitle.js";

// A record page with whs2's two actions, Close and the primary Submit, for the room a bar gives them beside its title
// and its own items. `?title=` sets the page's title. `?new=Document` makes it whs2's New Record page, whose sheet shows
// beside its register with no Up arrow: "Close new Document" is the page's way out (`close`), beside the primary
// "Submit Record".
const route = useRoute();
const kind = computed(() => String(route.query.new || ""));

useShellPageTitle(() => String(route.query.title || "Module record"));
</script>

<template>
  <section class="pa-4">
    <ShellPageActions>
      <ShellPageAction
        :close="Boolean(kind)"
        icon="$close"
        :label="kind ? `Close new ${kind}` : 'Close'"
        data-testid="fixture-review-close"
      />
      <ShellPageAction
        primary
        icon="$check"
        :label="kind ? 'Submit Record' : 'Submit'"
        data-testid="fixture-review-submit"
      />
    </ShellPageActions>
    <p>A record to review.</p>
  </section>
</template>
