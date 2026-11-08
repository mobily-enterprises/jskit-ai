<script setup>
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { usePaths } from "../../../src/client/navigation/usePaths.js";
import { records } from "./records.js";

const route = useRoute();
const paths = usePaths();
const kind = computed(() => String(route.meta.kind));
// A list that loads its rows draws them after the page opens: window.__fixtureRecordsDelayMs holds them back that long.
const delay = Number(window.__fixtureRecordsDelayMs) || 0;
const loaded = ref(delay <= 0);
if (!loaded.value) {
  window.setTimeout(() => {
    loaded.value = true;
  }, delay);
}
const items = computed(() => (loaded.value ? records[kind.value] || [] : []));
</script>

<template>
  <v-list lines="one" bg-color="transparent">
    <v-list-item
      v-for="item in items"
      :key="item.id"
      :to="paths.page(`/${kind}/${item.id}`)"
      :title="item.name"
    />
  </v-list>
</template>
