<script setup>
const modelValue = defineModel({
  type: String,
  default: ""
});

defineProps({
  readonly: {
    type: Boolean,
    default: false
  },
  errorMessages: {
    type: Array,
    default: () => []
  }
});
</script>

<template>
  <v-col cols="12" md="6">
    <v-text-field
      v-model="modelValue"
      label="Title"
      type="text"
      variant="outlined"
      density="comfortable"
      :maxlength="120"
      :readonly="readonly"
      :error-messages="errorMessages"
    />
  </v-col>
</template>
