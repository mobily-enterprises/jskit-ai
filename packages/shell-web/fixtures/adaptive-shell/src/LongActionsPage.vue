<script setup>
import { ref } from "vue";
import { useRoute } from "vue-router";
import ShellPageAction from "../../../src/client/components/ShellPageAction.vue";
import ShellPageActions from "../../../src/client/components/ShellPageActions.vue";
import { useShellPageTitle } from "../../../src/client/composables/useShellPageTitle.js";

// A record page whose labelled actions take most of a medium window's bar, as mobilynet's hosted service page does,
// then two actions of the overflow menu's own. `?title=` sets the page's title.
const route = useRoute();
const log = ref([]);

useShellPageTitle(() => String(route.query.title || "Hosted service"));
</script>

<template>
  <section class="pa-4">
    <ShellPageActions>
      <ShellPageAction icon="$tune" label="Change size" data-testid="fixture-long-action-size" @click="log.push('size')" />
      <ShellPageAction icon="$refresh" label="Restart" data-testid="fixture-long-action-restart" @click="log.push('restart')" />
      <ShellPageAction
        icon="$history"
        label="Restore into a new hosted service"
        data-testid="fixture-long-action-restore"
        @click="log.push('restore')"
      />
      <ShellPageAction icon="$edit" label="Add tags" data-testid="fixture-long-action-tags" @click="log.push('tags')" />
      <ShellPageAction
        overflow
        icon="$delete"
        label="Delete"
        color="error"
        data-testid="fixture-long-action-delete"
        @click="log.push('delete')"
      />
      <ShellPageAction overflow icon="$refresh" label="Update tooling" data-testid="fixture-long-action-tooling" @click="log.push('tooling')" />
    </ShellPageActions>

    <p data-testid="fixture-action-log">{{ log.join(",") }}</p>
  </section>
</template>
