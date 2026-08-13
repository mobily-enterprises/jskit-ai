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
import DefaultLoginView from "@jskit-ai/auth-web/client/views/DefaultLoginView";
</script>

<template>
  <DefaultLoginView />
</template>
