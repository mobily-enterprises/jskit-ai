<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "console"
    }
  }
}
</route>

<script setup>
import ShellLayout from "@/components/ShellLayout.vue";
import { RouterView } from "vue-router";
</script>

<template>
  <ShellLayout>
    <RouterView />
  </ShellLayout>
</template>
