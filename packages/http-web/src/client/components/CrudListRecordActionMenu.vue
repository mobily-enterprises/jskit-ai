<script setup>
import { computed } from "vue";

const props = defineProps({
  record: {
    type: Object,
    default: () => ({})
  },
  index: {
    type: Number,
    default: 0
  },
  rowActions: {
    type: Object,
    default: null
  },
  viewLocation: {
    type: Object,
    default: null
  },
  editLocation: {
    type: Object,
    default: null
  },
  showView: {
    type: Boolean,
    default: false
  },
  showEdit: {
    type: Boolean,
    default: false
  },
  buttonLabel: {
    type: String,
    default: "Actions"
  },
  buttonVariant: {
    type: String,
    default: "text"
  },
  buttonSize: {
    type: String,
    default: "small"
  }
});

const visibleRowActions = computed(() => {
  if (typeof props.rowActions?.visibleActionsFor !== "function") {
    return [];
  }
  return props.rowActions.visibleActionsFor(props.record, props.index);
});
const hasViewAction = computed(() => Boolean(props.showView && props.viewLocation));
const hasEditAction = computed(() => Boolean(props.showEdit && props.editLocation));
const hasActions = computed(() =>
  hasViewAction.value || hasEditAction.value || visibleRowActions.value.length > 0
);

function isRowActionLoading(action = {}) {
  return typeof props.rowActions?.isActionLoading === "function" &&
    props.rowActions.isActionLoading(action, props.record, props.index);
}

function isRowActionDisabled(action = {}) {
  return typeof props.rowActions?.isActionDisabled !== "function" ||
    props.rowActions.isActionDisabled(action, props.record, props.index);
}

function runRowAction(action = {}) {
  if (typeof props.rowActions?.execute !== "function") {
    return;
  }
  void props.rowActions.execute(action, props.record, props.index);
}
</script>

<template>
  <v-menu v-if="hasActions" location="bottom end">
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        :variant="buttonVariant"
        :size="buttonSize"
      >
        {{ buttonLabel }}
      </v-btn>
    </template>
    <v-list density="compact" min-width="150">
      <v-list-item
        v-if="hasViewAction"
        title="Open"
        :to="viewLocation"
      />
      <v-list-item
        v-if="hasEditAction"
        title="Edit"
        :to="editLocation"
      />
      <v-divider v-if="(hasViewAction || hasEditAction) && visibleRowActions.length > 0" />
      <v-list-item
        v-for="action in visibleRowActions"
        :key="action.key"
        :title="action.label"
        :base-color="action.color"
        :disabled="isRowActionDisabled(action)"
        @click="runRowAction(action)"
      >
        <template v-if="isRowActionLoading(action) || action.icon" #prepend>
          <v-progress-circular
            v-if="isRowActionLoading(action)"
            indeterminate
            size="18"
            width="2"
          />
          <v-icon v-else :icon="action.icon" />
        </template>
      </v-list-item>
    </v-list>
  </v-menu>
</template>
