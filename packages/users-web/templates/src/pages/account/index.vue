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
import AccountSettingsClientElement from "../../components/account/settings/AccountSettingsClientElement.vue";
</script>
