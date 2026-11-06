<script setup>
import { computed } from "vue";
import { RouterView, useRoute } from "vue-router";
import ShellListDetail from "@jskit-ai/shell-web/client/components/ShellListDetail";
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";

definePage({
  meta: {
    jskit: {
      title: "Workspace settings"
    }
  }
});

const route = useRoute();
// The section list shows beside the open section on wide windows, and on its own at the settings landing.
const detailOpen = computed(() => !/\/settings\/?$/u.test(route.path));
</script>

<template>
  <ShellListDetail :detail-open="detailOpen">
    <template #list>
      <nav aria-label="Workspace settings sections">
        <v-list nav>
          <ShellOutlet target="admin-settings:primary-menu" />
        </v-list>
      </nav>
    </template>
    <template #detail>
      <RouterView />
    </template>
  </ShellListDetail>
</template>
