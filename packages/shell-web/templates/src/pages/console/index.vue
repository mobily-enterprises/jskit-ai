<template>
  <v-card rounded="lg" elevation="1" border>
    <v-card-item>
      <template #prepend>
        <v-chip color="primary" size="small" label>Console</v-chip>
      </template>
      <v-card-title class="text-h5">Operations Console</v-card-title>
      <v-card-subtitle>Operator tools, scripts, and diagnostics.</v-card-subtitle>
    </v-card-item>
    <v-divider />
    <v-card-text class="d-flex flex-column ga-4">
      <div class="d-flex flex-wrap ga-3">
        <v-chip color="secondary" variant="tonal" label>Route: /console</v-chip>
        <v-chip color="info" variant="tonal" label>Surface status: enabled</v-chip>
      </div>
      <p class="text-medium-emphasis mb-0">
        Ideal for operator actions, scripts, and technical insights not meant for end users.
      </p>
      <div>
        <v-btn color="primary" variant="flat" to="/home">Back to home</v-btn>
      </div>
    </v-card-text>
  </v-card>
</template>
