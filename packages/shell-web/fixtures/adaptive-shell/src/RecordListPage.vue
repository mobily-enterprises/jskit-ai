<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { records } from "./records.js";

const route = useRoute();
const kind = computed(() => String(route.meta.kind));
const items = computed(() => records[kind.value] || []);
</script>

<template>
  <v-list lines="one" bg-color="transparent">
    <v-list-item
      v-for="item in items"
      :key="item.id"
      :to="`/home/${kind}/${item.id}`"
      :title="item.name"
    />
  </v-list>
</template>
