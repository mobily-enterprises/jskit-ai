<template>
  <v-card rounded="lg" elevation="1" border>
    <v-card-item>
      <template #prepend>
        <v-chip color="primary" size="small" label>Admin</v-chip>
      </template>
      <v-card-title class="text-h5">Administration</v-card-title>
      <v-card-subtitle>Privileged workflows and auditing.</v-card-subtitle>
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
        <v-btn color="primary" variant="flat" to="/">Back to app</v-btn>
      </div>
    </v-card-text>
  </v-card>
</template>
