<route lang="json">
{
  "meta": {
    "jskit": {
      "navigation": {
        "behavior": "destination",
        "destinationKey": "settings.assistant",
        "scope": ["principal", "surface"],
        "persistence": { "mode": "url-only" }
      }
    }
  }
}
</route>

<template>
  <AssistantSettingsClientElement target-surface-id="__ASSISTANT_SURFACE_ID__" />
</template>

<script setup>
import { AssistantSettingsClientElement } from "@jskit-ai/assistant-runtime/client";
</script>
