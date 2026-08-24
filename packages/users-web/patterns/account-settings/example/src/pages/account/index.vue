<route lang="json">
{
  "meta": {
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
