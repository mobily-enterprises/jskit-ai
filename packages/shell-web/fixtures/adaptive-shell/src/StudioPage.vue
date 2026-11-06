<script setup>
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import ShellPageAction from "../../../src/client/components/ShellPageAction.vue";
import ShellPageActions from "../../../src/client/components/ShellPageActions.vue";
import { useShellPageTitle } from "../../../src/client/composables/useShellPageTitle.js";
import { usePaths } from "../../../src/client/navigation/usePaths.js";
import { records } from "./records.js";

const route = useRoute();
const paths = usePaths();
const record = computed(() => records.contacts.find((item) => item.id === route.params.id) || null);

useShellPageTitle(() => (route.params.id ? record.value?.name || "Not found" : ""));
</script>

<template>
  <section>
    <ShellPageActions v-if="record">
      <ShellPageAction label="Run" primary />
    </ShellPageActions>
    <p v-else>
      <RouterLink :to="paths.page('/studio/ada')">Ada Lovelace</RouterLink>
    </p>
  </section>
</template>
