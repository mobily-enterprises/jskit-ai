<script setup>
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
import { RouterView } from "vue-router";
</script>

<template>
  <section class="settings-shell d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title>Console settings</v-card-title>
        <v-card-subtitle>Global configuration and reference data for the whole app.</v-card-subtitle>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <v-row no-gutters>
          <v-col cols="12" md="3" lg="2" class="pr-md-4 mb-4 mb-md-0">
            <v-list nav density="comfortable" rounded="lg" border>
              <ShellOutlet target="console-settings:primary-menu" />
            </v-list>
          </v-col>

          <v-col cols="12" md="9" lg="10">
            <RouterView />
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>
  </section>
</template>
