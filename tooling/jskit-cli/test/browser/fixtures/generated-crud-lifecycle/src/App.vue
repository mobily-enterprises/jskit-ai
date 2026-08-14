<script setup>
import { deleteRequestCount } from "./bookFixture.js";
</script>

<template>
  <v-app>
    <v-main>
      <v-container class="crud-lifecycle-fixture py-6">
        <router-view />
        <output data-testid="delete-request-count" class="crud-lifecycle-fixture__contract">
          {{ deleteRequestCount }}
        </output>
      </v-container>
    </v-main>
  </v-app>
</template>

<style>
html {
  overflow-x: hidden;
}

.crud-lifecycle-fixture {
  max-width: 72rem;
}

.crud-lifecycle-fixture__contract {
  height: 1px;
  overflow: hidden;
  position: absolute;
  width: 1px;
}
</style>
