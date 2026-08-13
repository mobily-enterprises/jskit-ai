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
import DefaultResetPasswordView from "@jskit-ai/auth-web/client/views/DefaultResetPasswordView";
</script>

<template>
  <DefaultResetPasswordView />
</template>
