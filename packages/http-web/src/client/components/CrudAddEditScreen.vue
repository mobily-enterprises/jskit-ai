<script setup>
import { computed, unref } from "vue";
import ShellPageAction from "@jskit-ai/shell-web/client/components/ShellPageAction";
import ShellPageActions from "@jskit-ai/shell-web/client/components/ShellPageActions";
import { useShellPageClose } from "@jskit-ai/shell-web/client/composables/useShellPageClose";
import { useShellNavigation } from "@jskit-ai/shell-web/client/navigation/useShellNavigation";
import { vPending } from "@jskit-ai/shell-web/client/directives/vPending";
import { describeCrudFieldValue } from "../composables/crud/crudSchemaFormHelpers.js";
import { isRetryableLoadStatus } from "../composables/support/resourceLoadStateHelpers.js";
import { useJskitText } from "../i18n.js";
import EditConflictNotice from "./EditConflictNotice.vue";

// A new or edit page as Material 3 lays out a full-screen form: the top app bar's leading close (X) cancels, Save is
// its one primary action, and the form's fields are below on the page. Where the bar has no Up arrow to turn into the
// close (a form opened directly, or beside its list), Cancel is a bar action before Save, the page's way out (`close`),
// which the bar never folds.

const props = defineProps({
  screen: {
    type: /** @type {import("vue").PropType<import("../types.js").CrudAddEditScreen>} */ (Object),
    required: true
  },
  // readable-check: allow collaborator-prop - optional operation: a form without lookup fields passes no lookup functions, and its fields slot receives null
  resolveLookupItems: {
    type: Function,
    default: null
  },
  // readable-check: allow collaborator-prop - optional operation: a form without lookup fields passes no lookup functions, and its fields slot receives null
  resolveLookupLoading: {
    type: Function,
    default: null
  },
  // readable-check: allow collaborator-prop - optional operation: a form without lookup fields passes no lookup functions, and its fields slot receives null
  resolveLookupSearch: {
    type: Function,
    default: null
  },
  // readable-check: allow collaborator-prop - optional operation: a form without lookup fields passes no lookup functions, and its fields slot receives null
  setLookupSearch: {
    type: Function,
    default: null
  }
});

const { t, text } = useJskitText();
const formRuntime = computed(() => props.screen.formRuntime);
const addEdit = computed(() => props.screen.addEdit);
// Trying again can help, as the load notice offers Retry: a refused load (403, 404, ...) has no Retry.
const loadFailureIsRetryable = computed(() => isRetryableLoadStatus(unref(addEdit.value.errorStatus)));
// A refused read says why: the server's message or a neutral text for its kind (the runtime's loadRefusalMessage).
const loadErrorText = computed(() =>
  String(unref(addEdit.value.loadRefusalMessage) || unref(addEdit.value.loadError) || "").trim()
);
const formState = computed(() => props.screen.formState);
const mode = computed(() => String(unref(props.screen.mode) || "new").trim() || "new");
const saveLabel = computed(() =>
  String(text(unref(props.screen.saveLabel)) || "").trim() || t("jskit.http.actions.save")
);
const cancelTo = computed(() => unref(props.screen.cancelTo) || "");

function resolveFieldErrors(fieldKey) {
  return props.screen.resolveFieldErrors(fieldKey);
}

// The fields whose server value changed while the person edited them (the form keeps the person's values), as the
// notice after the fields names them. A screen a page builds without a record read has none.
const conflictItems = computed(() => {
  const fields = unref(formRuntime.value.formFields) || [];
  return (unref(addEdit.value.conflicts) || []).map(({ key, value }) => {
    const field = fields.find((entry) => entry.key === key) || { key };
    return {
      key,
      label: String(text(field.label) || key),
      value: describeCrudFieldValue(field, value, {
        yes: t("jskit.http.crud.yes"),
        no: t("jskit.http.crud.no"),
        lookupLabel
      })
    };
  });
});

// A lookup's value is an id: the notice names the option it is, once the field's options hold it.
function lookupLabel(field, value) {
  if (!props.resolveLookupItems) {
    return "";
  }
  const items = props.resolveLookupItems(field.key, { selectedValue: value });
  return items.find((item) => item.value === value)?.label || "";
}

function resolveCancelTo(target = cancelTo.value) {
  return props.screen.resolveCancelTo(target);
}

// Cancel leaves the form the way it came, or to its cancel route when it was opened directly, replacing the form's
// history entry so neither Up nor Back reopens it.
const navigation = useShellNavigation();
const canCancel = computed(() => Boolean(cancelTo.value || navigation.upTarget.value));
const cancelInBar = computed(() => canCancel.value && !navigation.canGoUp.value);

function cancel() {
  return navigation.upTarget.value ? navigation.finish() : navigation.finish(resolveCancelTo(cancelTo.value));
}

useShellPageClose({ label: () => t("jskit.http.actions.cancel"), close: cancel });
</script>

<template>
  <section class="crud-screen crud-add-edit-form">
    <ShellPageActions>
      <slot
        name="actions"
        :screen="screen"
        :mode="mode"
        :form-runtime="formRuntime"
        :form-state="formState"
        :add-edit="addEdit"
        :save-label="saveLabel"
        :cancel-to="resolveCancelTo()"
        :submit="addEdit.submit"
      >
        <ShellPageAction
          v-if="cancelInBar"
          close
          icon="$close"
          :label="t('jskit.http.actions.cancel')"
          @click="cancel"
        />
        <ShellPageAction
          primary
          :label="addEdit.isSaving ? t('jskit.http.actions.saving') : saveLabel"
          :disabled="addEdit.isSubmitDisabled"
          :pending="addEdit.isSubmitPending"
          @click="addEdit.submit"
        />
      </slot>
    </ShellPageActions>

    <div v-if="addEdit.loadError" class="crud-add-edit-form__state">
      <v-icon icon="$cloudOff" size="48" />
      <p class="text-body-large">{{ loadErrorText }}</p>
      <v-btn
        v-if="addEdit.canRetryLoad && loadFailureIsRetryable"
        color="secondary-container"
        prepend-icon="$refresh"
        v-pending="addEdit.isFetching"
        @click="addEdit.refresh"
      >
        {{ addEdit.isFetching ? t("jskit.http.actions.retrying") : t("jskit.http.actions.retry") }}
      </v-btn>
    </div>
    <v-skeleton-loader v-else-if="formRuntime.showFormSkeleton" type="text@2, article" />
    <v-form v-else @submit.prevent="addEdit.submit" novalidate>
      <!-- Rows sit 16px apart: below a field's own supporting-text line, or below a field without one (hide-details, a
           switch or checkbox, a section heading). -->
      <v-row class="crud-add-edit-form__fields" :gap="[24, 16]">
        <slot
          name="fields"
          :mode="mode"
          :form-runtime="formRuntime"
          :form-state="formState"
          :add-edit="addEdit"
          :resolve-field-errors="resolveFieldErrors"
          :resolve-lookup-items="resolveLookupItems"
          :resolve-lookup-loading="resolveLookupLoading"
          :resolve-lookup-search="resolveLookupSearch"
          :set-lookup-search="setLookupSearch"
        />
      </v-row>
      <EditConflictNotice
        :items="conflictItems"
        @accept="addEdit.acceptServerValue"
        @keep="addEdit.keepOwnValue"
      />
    </v-form>
  </section>
</template>

<style scoped>
.crud-add-edit-form {
  margin-inline: auto;
  max-width: 840px;
  min-width: 0;
  width: 100%;
}

.crud-add-edit-form__state {
  align-items: center;
  color: rgb(var(--v-theme-on-surface-variant));
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-inline: auto;
  max-width: 480px;
  padding: 48px 16px;
  text-align: center;
}

.crud-add-edit-form__fields :deep(.v-col) {
  min-width: 0;
}
</style>
