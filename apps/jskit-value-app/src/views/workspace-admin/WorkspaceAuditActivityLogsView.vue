<template>
  <section class="workspace-audit-activity-logs-view py-2 py-md-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="text-h6">Audit / activity logs</v-card-title>
        <v-card-subtitle>Coming soon.</v-card-subtitle>
      </v-card-item>
      <v-divider />
      <v-card-text>
        <div class="placeholder-content">
          <v-icon icon="mdi-file-document-outline" size="34" class="mb-2" />
          <p class="text-body-1 mb-2">This screen is intentionally empty for now.</p>
          <p class="text-body-2 text-medium-emphasis mb-0">
            We will add searchable admin activity, security events, and export options here.
          </p>
        </div>
      </v-card-text>
    </v-card>
  </section>
</template>

<style scoped>
.placeholder-content {
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
</style>
