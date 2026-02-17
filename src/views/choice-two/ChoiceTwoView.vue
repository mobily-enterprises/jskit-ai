<template>
  <section class="choice-view py-2 py-md-4">
    <v-row>
      <v-col cols="12" md="8" lg="6">
        <v-card rounded="lg" elevation="1" border>
          <v-card-item>
            <v-card-title class="text-subtitle-1 font-weight-bold">{{ title }}</v-card-title>
            <v-card-subtitle>{{ subtitle }}</v-card-subtitle>
          </v-card-item>
          <v-divider />
          <v-card-text class="text-medium-emphasis">
            {{ body }}
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </section>
</template>

<script setup>
import { useChoiceTwoView } from "./useChoiceTwoView";

const {
  meta: { title, subtitle, body }
} = useChoiceTwoView();
</script>
