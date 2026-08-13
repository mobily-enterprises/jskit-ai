<route lang="json">
{
  "meta": {
    "jskit": {
      "navigation": {
        "behavior": "destination",
        "destinationKey": "assistant.home",
        "scope": ["principal", "surface"],
        "persistence": { "mode": "url-only" }
      }
    }
  }
}
</route>

<template>
  <AssistantSurfaceClientElement surface-id="__ASSISTANT_SURFACE_ID__" />
</template>

<script setup>
import { AssistantSurfaceClientElement } from "@jskit-ai/assistant-runtime/client";
</script>
