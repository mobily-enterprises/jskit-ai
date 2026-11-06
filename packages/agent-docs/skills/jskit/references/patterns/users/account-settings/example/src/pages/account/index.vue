<route lang="json">
{
  "meta": {
    "guard": {
      "policy": "authenticated"
    },
    "jskit": {
      "title": "Account settings",
      "parent": {
        "surface": "home",
        "path": "/"
      }
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
