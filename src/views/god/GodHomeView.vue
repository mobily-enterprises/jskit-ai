<template>
  <v-container fluid class="god-home pa-0">
    <v-row class="ma-0" justify="center">
      <v-col cols="12" sm="10" md="8" lg="6">
        <v-sheet class="pa-6 pa-sm-8" rounded="lg" border>
          <h1 class="text-h5 text-sm-h4 mb-3">God Console (empty scaffold)</h1>
          <p class="text-body-2 text-sm-body-1 mb-3">
            This authenticated surface is intentionally empty in this phase.
          </p>
          <p class="text-caption text-medium-emphasis mb-0">
            TODO: add god-specific logs, moderation consoles, and broader operations tooling in a future phase.
          </p>
        </v-sheet>
      </v-col>
    </v-row>
  </v-container>
</template>

<script>
export default {
  name: "GodHomeView"
};
</script>

<style scoped>
.god-home {
  min-height: min(100vh, 700px);
  display: grid;
  align-content: start;
  padding-top: clamp(16px, 4vh, 48px);
}
</style>
