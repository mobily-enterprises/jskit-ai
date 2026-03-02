<script setup>
import DefaultLoginView from "@jskit-ai/auth-web/client/views/DefaultLoginView";

const props = defineProps({
  loginComponent: {
    type: [Object, Function],
    default: () => DefaultLoginView
  }
});
</script>

<template>
  <component :is="props.loginComponent" />
</template>
