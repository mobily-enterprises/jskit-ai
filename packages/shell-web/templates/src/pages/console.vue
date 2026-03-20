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
import ShellLayout from "@jskit-ai/shell-web/client/components/ShellLayout";
import { RouterView } from "vue-router";
</script>

<template>
  <ShellLayout title="" subtitle="">
    <RouterView />
  </ShellLayout>
</template>
