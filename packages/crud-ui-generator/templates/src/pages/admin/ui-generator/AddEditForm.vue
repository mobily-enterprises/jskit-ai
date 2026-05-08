<template>
  <CrudAddEditScreen
    :screen="screen"
    :resolve-lookup-items="resolveLookupItems"
    :resolve-lookup-loading="resolveLookupLoading"
    :resolve-lookup-search="resolveLookupSearch"
    :set-lookup-search="setLookupSearch"
  >
    <template
      #fields="{
        mode,
        formState,
        addEdit,
        resolveFieldErrors,
        resolveLookupItems,
        resolveLookupLoading,
        resolveLookupSearch,
        setLookupSearch
      }"
    >
      <template v-if="mode === 'new'">
        <!-- jskit:crud-ui-fields:new -->
__JSKIT_UI_CREATE_FORM_COLUMNS__
      </template>
      <template v-else>
        <!-- jskit:crud-ui-fields:edit -->
__JSKIT_UI_EDIT_FORM_COLUMNS__
      </template>
    </template>
  </CrudAddEditScreen>
</template>

<script setup>
import CrudAddEditScreen from "@jskit-ai/users-web/client/components/CrudAddEditScreen";

defineProps({
  screen: {
    type: Object,
    required: true
  },
  resolveLookupItems: {
    type: Function,
    default: null
  },
  resolveLookupLoading: {
    type: Function,
    default: null
  },
  resolveLookupSearch: {
    type: Function,
    default: null
  },
  setLookupSearch: {
    type: Function,
    default: null
  }
});
</script>
