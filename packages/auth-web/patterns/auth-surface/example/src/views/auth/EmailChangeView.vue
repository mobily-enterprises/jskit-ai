<script setup>
import DefaultEmailChangeView from "@jskit-ai/auth-web/client/views/DefaultEmailChangeView";
import AppBrand from "@/components/AppBrand.vue";
</script>

<template>
  <DefaultEmailChangeView>
    <template #brand="{ compact }">
      <AppBrand :compact="compact" />
    </template>
  </DefaultEmailChangeView>
</template>
