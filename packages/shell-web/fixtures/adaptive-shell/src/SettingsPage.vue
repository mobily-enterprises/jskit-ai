<script setup>
import { computed } from "vue";
import { RouterView, useRoute } from "vue-router";
import ShellListDetail from "../../../src/client/components/ShellListDetail.vue";
import ShellMenuLinkItem from "../../../src/client/components/ShellMenuLinkItem.vue";
import { usePaths } from "../../../src/client/navigation/usePaths.js";

const route = useRoute();
const paths = usePaths();
const detailOpen = computed(() => route.path !== "/home/settings");
</script>

<template>
  <ShellListDetail :detail-open="detailOpen">
    <template #list>
      <v-list nav aria-label="Settings sections">
        <ShellMenuLinkItem label="General" :to="paths.page('/settings/general')" />
      </v-list>
    </template>
    <template #detail>
      <RouterView />
    </template>
  </ShellListDetail>
</template>
