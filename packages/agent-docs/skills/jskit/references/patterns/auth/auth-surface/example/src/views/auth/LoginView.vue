<script setup>
import DefaultLoginView from "@jskit-ai/auth-web/client/views/DefaultLoginView";
import AppBrand from "@/components/AppBrand.vue";
</script>

<template>
  <DefaultLoginView>
    <template #brand="{ compact }">
      <AppBrand :compact="compact" />
    </template>
  </DefaultLoginView>
</template>
