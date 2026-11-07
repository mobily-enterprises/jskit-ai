<script setup>
import { ref } from "vue";

const name = ref("");
const notes = ref("");
const size = ref("Medium");
</script>

<template>
  <v-app class="production-build-fixture">
    <v-main>
      <section class="pa-4">
        <v-btn data-testid="button-control">Save</v-btn>
        <v-btn data-testid="link-control" href="#saved">Open</v-btn>
        <!-- State layers: a rail's menu button, a profile menu's avatar activator, a disabled button. -->
        <v-btn data-testid="icon-control" icon="$menu" variant="text" aria-label="Menu" />
        <v-btn data-testid="avatar-control" icon variant="text" aria-label="Profile">
          <v-avatar size="32" color="primary-container">A</v-avatar>
        </v-btn>
        <v-btn data-testid="disabled-control" disabled>Reset password</v-btn>
        <v-text-field v-model="name" label="Name" data-testid="input-control" />
        <v-textarea v-model="notes" label="Notes" data-testid="textarea-control" />
        <v-select v-model="size" label="Size" :items="['Small', 'Medium', 'Large']" data-testid="select-control" />
      </section>
    </v-main>
  </v-app>
</template>
