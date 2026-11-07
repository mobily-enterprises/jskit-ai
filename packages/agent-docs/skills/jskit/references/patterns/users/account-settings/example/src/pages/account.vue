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
// The account surface's layout: the shell's top app bar carries the settings page's title and its Up arrow back to
// home, the page's only way out (a Done action shows only where Up can't go back, such as a returnTo on another of
// the app's origins). The surface has no navigation items, so the shell draws no navigation bar, rail or drawer.
import ShellLayout from "@/components/ShellLayout.vue";
import { RouterView } from "vue-router";
</script>

<template>
  <ShellLayout>
    <RouterView />
  </ShellLayout>
</template>
