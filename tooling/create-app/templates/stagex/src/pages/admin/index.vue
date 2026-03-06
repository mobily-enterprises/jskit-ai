<script setup>
const title = "Admin surface is ready.";
const subtitle = "Manage platform settings, operators, and governance from this surface.";
</script>

<template>
  <v-container class="py-8">
    <v-row justify="center">
      <v-col cols="12" md="10" lg="8">
        <v-card rounded="lg" elevation="1" border>
          <v-card-item>
            <template #prepend>
              <v-chip color="primary" size="small" label>Admin</v-chip>
            </template>
            <v-card-title class="text-h5">{{ title }}</v-card-title>
            <v-card-subtitle>{{ subtitle }}</v-card-subtitle>
          </v-card-item>
          <v-divider />
          <v-card-text class="d-flex flex-column ga-4">
            <div class="d-flex flex-wrap ga-3">
              <v-chip color="secondary" variant="tonal" label>Route: /admin</v-chip>
              <v-chip color="info" variant="tonal" label>Surface status: enabled</v-chip>
            </div>
            <p class="text-medium-emphasis mb-0">
              Keep this area focused on privileged administration and auditing workflows.
            </p>
            <div>
              <v-btn color="primary" variant="flat" to="/app">Back to app</v-btn>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>
