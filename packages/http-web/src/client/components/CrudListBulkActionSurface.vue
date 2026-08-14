<script setup>
import { computed } from "vue";
import { useDisplay } from "vuetify";

const props = defineProps({
  runtime: {
    type: Object,
    default: null
  },
  title: {
    type: String,
    default: "Selection"
  }
});

const display = useDisplay();
const isCompactLayout = computed(() => {
  const displayName = String(display?.name?.value || "").trim().toLowerCase();
  return displayName === "xs" || displayName === "sm";
});
const actions = computed(() => Array.isArray(props.runtime?.actions) ? props.runtime.actions : []);
const selectedCount = computed(() => Number(props.runtime?.selectedCount?.value || 0));
const shouldRender = computed(() =>
  Boolean(props.runtime?.hasActions?.value) &&
  Boolean(props.runtime?.hasSelection?.value) &&
  selectedCount.value > 0
);

function clearSelection() {
  props.runtime?.clearSelection?.();
}

function execute(action = {}) {
  props.runtime?.execute?.(action);
}

function isActionDisabled(action = {}) {
  return Boolean(props.runtime?.isActionDisabled?.(action));
}

function isActionExecuting(action = {}) {
  return Boolean(props.runtime?.isActionExecuting?.(action));
}
</script>

<template>
  <section v-if="shouldRender" class="crud-list-bulk-action-surface">
    <div class="crud-list-bulk-action-surface__summary">
      <div class="crud-list-bulk-action-surface__copy">
        <span class="text-overline text-medium-emphasis">{{ title }}</span>
        <strong>{{ selectedCount }} selected</strong>
      </div>
      <v-btn size="small" variant="text" @click="clearSelection">Clear</v-btn>
    </div>

    <div v-if="!isCompactLayout" class="crud-list-bulk-action-surface__actions">
      <v-btn
        v-for="action in actions"
        :key="action.key"
        :color="action.color"
        :variant="action.variant"
        :prepend-icon="action.icon || undefined"
        :disabled="isActionDisabled(action)"
        :loading="isActionExecuting(action)"
        @click="execute(action)"
      >
        {{ action.label }}
      </v-btn>
    </div>

    <v-menu v-else location="bottom end">
      <template #activator="{ props: menuProps }">
        <v-btn v-bind="menuProps" color="primary" variant="tonal">Bulk actions</v-btn>
      </template>
      <v-list density="compact" min-width="180">
        <v-list-item
          v-for="action in actions"
          :key="action.key"
          :title="action.label"
          :prepend-icon="action.icon || undefined"
          :disabled="isActionDisabled(action)"
          @click="execute(action)"
        />
      </v-list>
    </v-menu>
  </section>
</template>

<style scoped>
.crud-list-bulk-action-surface {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.08);
  border-block: 1px solid rgba(var(--v-theme-primary), 0.18);
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
  padding: 0.75rem 1rem;
}

.crud-list-bulk-action-surface__summary,
.crud-list-bulk-action-surface__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-width: 0;
}

.crud-list-bulk-action-surface__copy {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
}

.crud-list-bulk-action-surface :deep(.v-btn) {
  min-height: 48px;
}

@media (max-width: 640px) {
  .crud-list-bulk-action-surface {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
