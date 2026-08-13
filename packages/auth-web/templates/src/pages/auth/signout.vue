<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "auth",
      "navigation": {
        "behavior": "boundary",
        "persistence": { "mode": "none" }
      }
    },
    "guard": {
      "policy": "public"
    }
  }
}
</route>

<script setup>
import DefaultSignOutView from "@jskit-ai/auth-web/client/views/DefaultSignOutView";
</script>

<template>
  <DefaultSignOutView />
</template>
