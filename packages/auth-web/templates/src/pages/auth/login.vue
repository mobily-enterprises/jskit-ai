<route lang="json">
{
  "meta": {
    "guard": {
      "policy": "public"
    },
    "jskit": {
      "scope": "global"
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
