<script setup>
import { ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import ShellPageAction from "../../../src/client/components/ShellPageAction.vue";
import ShellPageActions from "../../../src/client/components/ShellPageActions.vue";
import ShellPrimaryAction from "../../../src/client/components/ShellPrimaryAction.vue";
import { useShellPageTitle } from "../../../src/client/composables/useShellPageTitle.js";
import { usePaths } from "../../../src/client/navigation/usePaths.js";
import TitleClaim from "./TitleClaim.vue";

// Page actions in every form: icon-only and labelled, links that leave the app or download a file, a destructive one,
// an overflow one and, on compact windows, more than the bar holds; the adaptive primary action opening a dialog; and
// a nested component that claims the title for a while, or a title too long for a phone's bar. `?title=` sets the
// page's own title.
const paths = usePaths();
const route = useRoute();
const log = ref([]);
const dialog = ref(false);
const panel = ref(false);
const longTitle = ref(false);

useShellPageTitle(() => String(route.query.title || "Page actions"));
</script>

<template>
  <section class="pa-4">
    <ShellPageActions>
      <ShellPageAction icon="$edit" label="Edit" data-testid="fixture-action-edit" @click="log.push('edit')" />
      <ShellPageAction
        icon="$download"
        label="Export"
        href="/records.csv"
        download="records.csv"
        data-testid="fixture-action-export"
      />
      <ShellPageAction
        icon="$openInNew"
        label="Open site"
        href="https://example.com/"
        target="_blank"
        data-testid="fixture-action-site"
      />
      <ShellPageAction
        icon="$delete"
        label="Delete"
        color="error"
        data-testid="fixture-action-delete"
        @click="log.push('delete')"
      />
      <ShellPageAction
        overflow
        icon="$contentCopy"
        label="Duplicate"
        data-testid="fixture-action-duplicate"
        @click="log.push('duplicate')"
      />
    </ShellPageActions>
    <ShellPrimaryAction label="New record" data-testid="fixture-primary" @click="dialog = true" />

    <p data-testid="fixture-action-log">{{ log.join(",") }}</p>
    <p>
      <RouterLink :to="paths.page('/actions/new')">New entry</RouterLink>
    </p>
    <v-btn variant="text" data-testid="fixture-toggle-panel" @click="panel = !panel">Toggle panel</v-btn>
    <TitleClaim v-if="panel" title="Panel title" />
    <v-btn variant="text" data-testid="fixture-toggle-long-title" @click="longTitle = !longTitle">Toggle long title</v-btn>
    <TitleClaim v-if="longTitle" title="Quarterly statements for every supplier" />

    <v-dialog v-model="dialog" max-width="400">
      <v-card title="New record" data-testid="fixture-new-dialog">
        <v-card-text>Fill in the record.</v-card-text>
        <v-card-actions>
          <v-btn @click="dialog = false">Cancel</v-btn>
          <v-btn @click="dialog = false">Create</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>
