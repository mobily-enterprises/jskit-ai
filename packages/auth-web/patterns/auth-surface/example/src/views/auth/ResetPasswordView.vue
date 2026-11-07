<script setup>
import DefaultResetPasswordView from "@jskit-ai/auth-web/client/views/DefaultResetPasswordView";
import AppBrand from "@/components/AppBrand.vue";
</script>

<template>
  <DefaultResetPasswordView>
    <template #brand="{ compact }">
      <AppBrand :compact="compact" />
    </template>
  </DefaultResetPasswordView>
</template>
