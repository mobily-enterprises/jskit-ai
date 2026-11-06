<script setup>
import { computed } from "vue";
import { useJskitText } from "../i18n.js";

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
    type: /** @type {import("vue").PropType<import("../types.js").CrudListRowActions>} */ (Object),
    required: true
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
  // The record's title, which names the menu for assistive technology.
  title: {
    type: String,
    default: ""
  }
});

const { t, text } = useJskitText();
const buttonLabel = computed(() =>
  props.title ? t("jskit.http.crud.list.recordActions", { title: props.title }) : t("jskit.http.actions.more")
);

const visibleRowActions = computed(() => props.rowActions.visibleActionsFor(props.record, props.index));
const hasViewAction = computed(() => Boolean(props.showView && props.viewLocation));
const hasEditAction = computed(() => Boolean(props.showEdit && props.editLocation));
const hasActions = computed(() =>
  hasViewAction.value || hasEditAction.value || visibleRowActions.value.length > 0
);

function isRowActionLoading(action) {
  return props.rowActions.isActionLoading(action, props.record, props.index);
}

// Action labels may be message keys.
function rowActionLabel(action) {
  const label = text(action.label);
  return isRowActionLoading(action) ? t("jskit.http.actions.running", { label }) : label;
}

function isRowActionDisabled(action) {
  return props.rowActions.isActionDisabled(action, props.record, props.index);
}

function runRowAction(action) {
  void props.rowActions.execute(action, props.record, props.index);
}
</script>

<template>
  <v-menu v-if="hasActions" location="bottom end">
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        class="crud-list-record-action-menu"
        icon="$moreVert"
        variant="text"
        color="on-surface-variant"
        :aria-label="buttonLabel"
      />
    </template>
    <v-list min-width="160">
      <v-list-item
        v-if="hasViewAction"
        prepend-icon="$visibility"
        :title="t('jskit.http.actions.open')"
        :to="viewLocation"
      />
      <v-list-item
        v-if="hasEditAction"
        prepend-icon="$edit"
        :title="t('jskit.http.actions.edit')"
        :to="editLocation"
      />
      <v-divider v-if="(hasViewAction || hasEditAction) && visibleRowActions.length > 0" />
      <v-list-item
        v-for="action in visibleRowActions"
        :key="action.key"
        :title="rowActionLabel(action)"
        :base-color="action.color"
        :disabled="isRowActionDisabled(action)"
        @click="runRowAction(action)"
      >
        <template v-if="action.icon" #prepend>
          <v-icon :icon="action.icon" />
        </template>
      </v-list-item>
    </v-list>
  </v-menu>
</template>
