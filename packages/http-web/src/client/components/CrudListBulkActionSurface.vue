<script setup>
import { computed } from "vue";
import { useShellWindowSizeClass } from "@jskit-ai/shell-web/client/composables/useShellWindowSizeClass";
import { useJskitText } from "../i18n.js";

const props = defineProps({
  runtime: {
    type: /** @type {import("vue").PropType<import("../types.js").CrudListBulkActions>} */ (Object),
    required: true
  },
  title: {
    type: String,
    default: undefined
  }
});

const { t, text } = useJskitText();
const resolvedTitle = computed(() =>
  props.title === undefined ? t("jskit.http.crud.bulk.selection") : text(props.title)
);

const { isCompact: isCompactLayout } = useShellWindowSizeClass();

const actions = computed(() => props.runtime.actions);
const selectedCount = computed(() => props.runtime.selectedCount.value);
const shouldRender = computed(() =>
  props.runtime.hasActions.value &&
  props.runtime.hasSelection.value &&
  selectedCount.value > 0
);

function clearSelection() {
  props.runtime.clearSelection();
}

function execute(action) {
  props.runtime.execute(action);
}

function isActionDisabled(action) {
  return props.runtime.isActionDisabled(action);
}

function isActionExecuting(action) {
  return props.runtime.isActionExecuting(action);
}

// Action labels may be message keys.
function actionLabel(action = {}) {
  const label = text(action.label);
  return isActionExecuting(action) ? t("jskit.http.actions.running", { label }) : label;
}
</script>

<template>
  <section v-if="shouldRender" class="crud-list-bulk-action-surface">
    <div class="crud-list-bulk-action-surface__summary">
      <div class="crud-list-bulk-action-surface__copy">
        <span class="crud-list-bulk-action-surface__title">{{ resolvedTitle }}</span>
        <span class="crud-list-bulk-action-surface__count">{{ t("jskit.http.crud.bulk.selected", { count: selectedCount }) }}</span>
      </div>
      <v-btn variant="text" color="on-secondary-container" @click="clearSelection">{{ t("jskit.http.actions.clear") }}</v-btn>
    </div>

    <div v-if="!isCompactLayout" class="crud-list-bulk-action-surface__actions">
      <v-btn
        v-for="action in actions"
        :key="action.key"
        :color="action.color"
        :variant="action.variant"
        :prepend-icon="action.icon || undefined"
        :disabled="isActionDisabled(action)"
        @click="execute(action)"
      >
        {{ actionLabel(action) }}
      </v-btn>
    </div>

    <v-menu v-else location="bottom end">
      <template #activator="{ props: menuProps }">
        <v-btn v-bind="menuProps" color="primary">{{ t("jskit.http.crud.bulk.actions") }}</v-btn>
      </template>
      <v-list min-width="180">
        <v-list-item
          v-for="action in actions"
          :key="action.key"
          :title="actionLabel(action)"
          :prepend-icon="action.icon || undefined"
          :disabled="isActionDisabled(action)"
          @click="execute(action)"
        />
      </v-list>
    </v-menu>
  </section>
</template>

<style scoped>
/* A selection toolbar in the secondary container, as Material 3 marks a selected state. */
.crud-list-bulk-action-surface {
  align-items: center;
  background: rgb(var(--v-theme-secondary-container));
  border-radius: 16px;
  color: rgb(var(--v-theme-on-secondary-container));
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: space-between;
  min-width: 0;
  padding: 8px 8px 8px 16px;
}

.crud-list-bulk-action-surface__summary,
.crud-list-bulk-action-surface__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.crud-list-bulk-action-surface__copy {
  display: grid;
  min-width: 0;
}

.crud-list-bulk-action-surface__title {
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.03125rem;
  line-height: 1rem;
}

.crud-list-bulk-action-surface__count {
  font-size: 1rem;
  font-weight: 500;
  letter-spacing: 0.009375rem;
  line-height: 1.5rem;
}
</style>
