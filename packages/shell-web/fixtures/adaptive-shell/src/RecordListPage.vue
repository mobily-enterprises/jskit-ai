<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { usePaths } from "../../../src/client/navigation/usePaths.js";
import { records } from "./records.js";

const route = useRoute();
const paths = usePaths();
const kind = computed(() => String(route.meta.kind));
const items = computed(() => records[kind.value] || []);
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
