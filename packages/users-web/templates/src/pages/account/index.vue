<route lang="json">
{
  "meta": {
    "jskit": {
      "navigation": {
        "behavior": "destination",
        "destinationKey": "account.settings",
        "scope": ["principal", "surface"],
        "persistence": { "mode": "url-only" }
      }
    },
    "guard": {
      "policy": "authenticated"
    }
  }
}
</route>

<template>
  <AccountSettingsClientElement />
</template>

<script setup>
import AccountSettingsClientElement from "@jskit-ai/users-web/client/components/AccountSettingsClientElement";
</script>
