<script setup>
const title = "Not Found";
const message = "The page you requested does not exist.";
</script>

<template>
  <v-container class="fill-height d-flex align-center justify-center">
    <section class="on-surface-variant text-center">
      <v-icon icon="$searchOff" size="48" />
      <h1 class="text-headline-small on-surface mt-4 mb-2">{{ title }}</h1>
      <p class="text-body-large mb-0">{{ message }}</p>
    </section>
  </v-container>
</template>
