<route lang="json">
{
  "meta": {
    "guard": {
      "policy": "authenticated"
    },
    "jskit": {
      "title": "Account settings",
      "parent": "/"
    }
  }
}
</route>

<template>
  <AccountSettingsClientElement />
</template>

<script setup>
// One section of account settings (/account/preferences). Its parent is the section list, the surface's "/", so on a
// phone Up returns to the list; a wide window shows the list beside the section.
import AccountSettingsClientElement from "@jskit-ai/users-web/client/components/AccountSettingsClientElement";
</script>
