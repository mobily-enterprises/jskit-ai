<template>
  <div class="sync-status" role="status" aria-label="Catalogue synchronized">
    <v-icon icon="mdi-cloud-check-outline" size="small" aria-hidden="true" />
    <span class="text-body-2">Synced</span>
  </div>
</template>

<style scoped>
.sync-status {
  align-items: center;
  display: inline-flex;
  gap: 0.5rem;
  min-height: 48px;
  min-width: 0;
}
</style>
