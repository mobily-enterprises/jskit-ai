<script setup>
import DefaultSignOutView from "@jskit-ai/auth-web/client/views/DefaultSignOutView";
import AppBrand from "@/components/AppBrand.vue";
</script>

<template>
  <DefaultSignOutView>
    <template #brand="{ compact }">
      <AppBrand :compact="compact" />
    </template>
  </DefaultSignOutView>
</template>
