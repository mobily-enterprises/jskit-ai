<template>
  <CrudAddEditScreen
    :screen="props.screen"__JSKIT_UI_SHARED_LOOKUP_FORM_PROPS__
  >
    <template
      #fields="__JSKIT_UI_SHARED_FORM_SLOT_PROPS__"
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

const props = defineProps({
  screen: {
    type: Object,
    required: true
  }
__JSKIT_UI_FORM_LOOKUP_PROP_DEFS__
});
</script>
