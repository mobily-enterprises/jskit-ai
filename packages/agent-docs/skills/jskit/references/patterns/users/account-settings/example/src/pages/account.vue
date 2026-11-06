<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "account"
    }
  }
}
</route>

<script setup>
// The account surface's layout: the shell's top app bar carries the settings page's title, its Up arrow back to home
// and its Done action. The surface has no navigation items, so the shell draws no navigation bar, rail or drawer.
import ShellLayout from "@/components/ShellLayout.vue";
import { RouterView } from "vue-router";
</script>

<template>
  <ShellLayout title="" subtitle="">
    <RouterView />
  </ShellLayout>
</template>
